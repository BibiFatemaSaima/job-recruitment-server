const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// ================= CORS =================

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  ...(process.env.CLIENT_URL || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean),
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json({ limit: "1mb" }));

// ================= MONGODB =================
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.za28cg0.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri);

let db;
let connectionPromise;

const connectToMongoDB = async () => {
  if (db) return db;

  if (!process.env.DB_USER || !process.env.DB_PASS) {
    throw new Error("DB_USER or DB_PASS is missing from .env");
  }

  if (!process.env.DB_NAME) {
    throw new Error("DB_NAME is missing from .env");
  }

  if (!connectionPromise) {
    connectionPromise = client
      .connect()
      .then(() => {
        db = client.db(process.env.DB_NAME);
        console.log("Successfully connected to MongoDB!");
        return db;
      })
      .catch((error) => {
        connectionPromise = null;
        throw error;
      });
  }

  return connectionPromise;
};
// collections
const getJobsCollection = async () => {
  const database = await connectToMongoDB();
  return database.collection("jobs");
};
const getUsersCollection = async () => {
  const database = await connectToMongoDB();
  return database.collection("users");
};

const getApplicationsCollection = async () => {
  const database = await connectToMongoDB();
  return database.collection("applications");
};
// Get saved jobs collection
const getSavedJobsCollection = async () => {
  const database = await connectToMongoDB();
  return database.collection("savedJobs");
};
// ================= HOME =================

app.get("/", (req, res) => {
  res.send("Job Recruitment Portal Server is Running");
});

// ================= HEALTH CHECK =================

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Job Recruitment Portal API is running",
  });
});

app.get("/api/health/db", async (req, res, next) => {
  try {
    await connectToMongoDB();

    res.json({
      success: true,
      message: "MongoDB connected successfully",
    });
  } catch (error) {
    next(error);
  }
});

// ================= GET ALL JOBS =================

app.get("/jobs", async (req, res, next) => {
  try {
    const jobsCollection = await getJobsCollection();

    const jobs = await jobsCollection.find().sort({ createdAt: -1 }).toArray();

    res.json(jobs);
  } catch (error) {
    next(error);
  }
});

// ================= GET SINGLE JOB =================

app.get("/jobs/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid job ID" });
    }

    const jobsCollection = await getJobsCollection();

    const job = await jobsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    res.json(job);
  } catch (error) {
    next(error);
  }
});
// user related api
app.post("/users", async (req, res, next) => {
  try {
    const { name, email, role } = req.body;

    if (!name || !email || !["jobSeeker", "employer"].includes(role)) {
      return res.status(400).json({
        message: "Valid name, email, and role are required.",
      });
    }

    const users = await getUsersCollection();

    const existingUser = await users.findOne({ email });

    if (existingUser) {
      return res.status(409).json({
        message: "User already exists.",
      });
    }

    const result = await users.insertOne({
      name,
      email,
      role,
      createdAt: new Date(),
    });

    res.status(201).json({
      success: true,
      userId: result.insertedId,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/users/:email", async (req, res, next) => {
  try {
    const email = req.params.email;
    const users = await getUsersCollection();

    const user = await users.findOne(
      { email },
      { projection: { name: 1, email: 1, role: 1 } },
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    res.send(user);
  } catch (error) {
    next(error);
  }
});

// ================= CREATE JOB =================

app.post("/jobs", async (req, res, next) => {
  try {
    const {
      title,
      company,
      description,
      requirements,
      location,
      salary,
      category,
      deadline,
      employerEmail,
    } = req.body;

    if (
      !title?.trim() ||
      !company?.trim() ||
      !description?.trim() ||
      !location?.trim() ||
      !employerEmail?.trim()
    ) {
      return res.status(400).json({
        message:
          "Title, company, description, location and employer email are required",
      });
    }

    const newJob = {
      title: title.trim(),
      company: company.trim(),
      description: description.trim(),
      requirements: Array.isArray(requirements) ? requirements : [],
      location: location.trim(),
      salary: salary || "Negotiable",
      category: category || "Other",
      deadline: deadline || "",
      employerEmail: employerEmail.trim().toLowerCase(),
      createdAt: new Date(),
    };

    const jobsCollection = await getJobsCollection();
    const result = await jobsCollection.insertOne(newJob);

    res.status(201).json({
      success: true,
      message: "Job created successfully",
      insertedId: result.insertedId,
    });
  } catch (error) {
    next(error);
  }
});
// =================job applications==============
app.post("/applications", async (req, res, next) => {
  try {
    const { jobId, applicantName, applicantEmail, coverLetter, resumeUrl } =
      req.body;

    if (!jobId || !applicantName || !applicantEmail || !coverLetter) {
      return res.status(400).json({
        message: "Please provide all required application details.",
      });
    }

    const jobs = await getJobsCollection();
    const job = await jobs.findOne({
      _id: new ObjectId(jobId),
    });

    if (!job) {
      return res.status(404).json({
        message: "Job not found.",
      });
    }

    const applications = await getApplicationsCollection();

    const existingApplication = await applications.findOne({
      jobId,
      applicantEmail,
    });

    if (existingApplication) {
      return res.status(409).json({
        message: "You have already applied for this job.",
      });
    }

    const application = {
      jobId,
      jobTitle: job.title,
      company: job.company,
      applicantName,
      applicantEmail,
      coverLetter,
      resumeUrl: resumeUrl || "",
      status: "Pending",
      appliedAt: new Date(),
    };

    const result = await applications.insertOne(application);

    res.status(201).json({
      success: true,
      message: "Application submitted successfully!",
      applicationId: result.insertedId,
    });
  } catch (error) {
    next(error);
  }
});
// Save and retrieve saved jobs
app.post("/saved-jobs", async (req, res, next) => {
  try {
    const { jobId, userEmail } = req.body;

    if (!jobId || !userEmail || !ObjectId.isValid(jobId)) {
      return res.status(400).send({
        message: "Valid job ID and user email are required.",
      });
    }

    const jobs = await getJobsCollection();
    const job = await jobs.findOne({ _id: new ObjectId(jobId) });

    if (!job) {
      return res.status(404).send({ message: "Job not found." });
    }

    const savedJobs = await getSavedJobsCollection();

    const existing = await savedJobs.findOne({ jobId, userEmail });

    if (existing) {
      return res.status(409).send({ message: "Job already saved." });
    }

    await savedJobs.insertOne({
      jobId,
      userEmail,
      jobTitle: job.title,
      company: job.company,
      savedAt: new Date(),
    });

    res.status(201).send({ success: true, message: "Job saved successfully." });
  } catch (error) {
    next(error);
  }
});

app.get("/saved-jobs/:email", async (req, res, next) => {
  try {
    const userEmail = decodeURIComponent(req.params.email);
    const savedJobs = await getSavedJobsCollection();

    const result = await savedJobs
      .find({ userEmail })
      .sort({ savedAt: -1 })
      .toArray();

    res.send(result);
  } catch (error) {
    next(error);
  }
});

// Remove a saved job
app.delete("/saved-jobs/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { userEmail } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid saved job ID." });
    }

    const savedJobsCollection = await getSavedJobsCollection();

    const result = await savedJobsCollection.deleteOne({
      _id: new ObjectId(id),
      userEmail,
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({ message: "Saved job not found." });
    }

    res.send({ message: "Job removed from saved jobs successfully." });
  } catch (error) {
    res.status(500).send({ message: "Failed to remove saved job." });
  }
});

app.get("/applications/:email", async (req, res, next) => {
  try {
    const email = req.params.email;

    const applications = await getApplicationsCollection();

    const result = await applications
      .find({ applicantEmail: email })
      .sort({ appliedAt: -1 })
      .toArray();

    res.send(result);
  } catch (error) {
    next(error);
  }
});
// GET API: Get applicants for an employer's jobs
app.get("/employer-applications/:email", async (req, res, next) => {
  try {
    const email = req.params.email;

    const jobs = await getJobsCollection();
    const employerJobs = await jobs.find({ employerEmail: email }).toArray();

    const jobIds = employerJobs.map((job) => job._id.toString());

    const applications = await getApplicationsCollection();
    const result = await applications
      .find({ jobId: { $in: jobIds } })
      .sort({ appliedAt: -1 })
      .toArray();

    res.send(result);
  } catch (error) {
    next(error);
  }
});

// PUT API: Update an application status
app.put("/applications/:id/status", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowedStatuses = [
      "Pending",
      "Reviewed",
      "Shortlisted",
      "Interview",
      "Rejected",
      "Hired",
    ];

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid application ID." });
    }

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid application status." });
    }

    const applications = await getApplicationsCollection();

    const result = await applications.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status } },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Application not found." });
    }

    res.send({
      success: true,
      message: "Application status updated successfully.",
    });
  } catch (error) {
    next(error);
  }
});

// ================= UPDATE JOB =================

// PUT API: Update a job posted by the employer
app.put("/jobs/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid job ID" });
    }

    const {
      title,
      company,
      description,
      requirements,
      location,
      salary,
      category,
      deadline,
      employerEmail,
    } = req.body;

    if (!employerEmail?.trim()) {
      return res.status(400).json({
        message: "Employer email is required",
      });
    }

    if (
      !title?.trim() ||
      !company?.trim() ||
      !description?.trim() ||
      !location?.trim()
    ) {
      return res.status(400).json({
        message: "Title, company, description and location are required",
      });
    }

    const jobsCollection = await getJobsCollection();

    const result = await jobsCollection.updateOne(
      {
        _id: new ObjectId(id),
        employerEmail: employerEmail.trim().toLowerCase(),
      },
      {
        $set: {
          title: title.trim(),
          company: company.trim(),
          description: description.trim(),
          requirements: Array.isArray(requirements) ? requirements : [],
          location: location.trim(),
          salary: salary || "Negotiable",
          category: category || "Other",
          deadline: deadline || "",
          updatedAt: new Date(),
        },
      },
    );

    if (!result.matchedCount) {
      return res.status(404).json({
        message: "Job not found or you are not authorized to update it",
      });
    }

    res.json({
      success: true,
      message: "Job updated successfully",
    });
  } catch (error) {
    next(error);
  }
});

// ================= DELETE JOB =================

app.delete("/jobs/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { employerEmail } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid job ID" });
    }

    if (!employerEmail?.trim()) {
      return res.status(400).json({
        message: "Employer email is required",
      });
    }

    const jobsCollection = await getJobsCollection();

    const result = await jobsCollection.deleteOne({
      _id: new ObjectId(id),
      employerEmail: employerEmail.trim().toLowerCase(),
    });

    if (!result.deletedCount) {
      return res.status(404).json({
        message: "Job not found or you are not authorized to delete it",
      });
    }

    res.json({
      success: true,
      message: "Job deleted successfully",
    });
  } catch (error) {
    next(error);
  }
});

// ================= ERROR HANDLER =================

app.use((error, req, res, next) => {
  console.error(error.message);

  if (res.headersSent) {
    return next(error);
  }

  if (error.message === "Not allowed by CORS") {
    return res.status(403).json({
      message: "Origin not allowed",
    });
  }

  res.status(500).json({
    message: "Internal server error",
  });
});

// ================= START SERVER =================

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

module.exports = app;
