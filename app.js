const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");
const bodyParser = require("body-parser");
const morgan = require("morgan");
const helmet = require("helmet");
const session = require("express-session");
const fs = require("fs");
const { body, validationResult } = require("express-validator");
const User = require("./models/User");
const json2csv = require("json2csv").parse;
const rateLimit = require("express-rate-limit");
const axios = require("axios");

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASS || "admin123";

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "formapp_secret",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === "production", maxAge: 24 * 60 * 60 * 1000 },
  })
);
app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/node_modules", express.static(path.join(__dirname, "node_modules")));
const accessLogStream = fs.createWriteStream(path.join(__dirname, "access.log"), { flags: "a" });
app.use(morgan("combined", { stream: accessLogStream }));

// Rate Limiting Middleware
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});
app.use("/api/validate", apiLimiter);

// MongoDB connection with retry logic
const connectWithRetry = () => {
  mongoose
    .connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      retryWrites: true,
      maxPoolSize: 10,
    })
    .then(() => {
      console.log("✅ Connected to MongoDB");
    })
    .catch((err) => {
      console.error("❌ MongoDB connection failed:", err.message);
      console.log("Retrying connection in 5 seconds...");
      setTimeout(connectWithRetry, 5000);
    });
};
connectWithRetry();

// Middleware to protect admin-only pages
function ensureAdmin(req, res, next) {
  try {
    if (req.session && req.session.isAdmin) return next();
    console.log("Unauthorized access, redirecting to /admin");
    return res.redirect("/admin");
  } catch (err) {
    console.error("❌ Error in ensureAdmin middleware:", err.message);
    res.status(500).json({ error: "Session error" });
  }
}

// Make session available to all views
app.use((req, res, next) => {
  res.locals.isAdmin = req.session.isAdmin || false;
  next();
});

// External API Service (email validation)
async function validateEmail(email) {
  try {
    const response = await axios.get("https://emailvalidation.abstractapi.com/v1/", {
      params: { api_key: process.env.EMAIL_VALIDATION_API_KEY, email: email },
    });
    console.log("API Response:", response.data);
    const data = response.data;
    if (data && typeof data.deliverability === "string" && typeof data.quality_score === "string") {
      const isValid = data.deliverability === "DELIVERABLE" && parseFloat(data.quality_score) > 0.7;
      return {
        isValid: isValid,
        message: isValid ? "Email validated" : `Email ${data.deliverability.toLowerCase()} (Quality: ${data.quality_score})`
      };
    } else {
      throw new Error("Invalid API response format");
    }
  } catch (error) {
    console.error("Email validation error:", error.response ? error.response.data : error.message);
    throw new Error("Failed to validate email: " + (error.response ? error.response.data.error : error.message));
  }
}

// New Route for Email Validation (for client-side use)
app.get("/api/validate-email", async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) return res.status(400).json({ isValid: false, message: "Email is required" });
    const result = await validateEmail(email);
    res.json(result);
  } catch (error) {
    console.error("Validation endpoint error:", error.message);
    res.status(500).json({ isValid: false, message: "Validation service unavailable: " + error.message });
  }
});

// RESTful API Routes (admin-only)
app.get("/api/users", ensureAdmin, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const skip = (page - 1) * limit;
  const search = req.query.search ? req.query.search.trim() : '';

  try {
    let query = {};
    if (search) {
      query = {
        name: { $regex: search, $options: 'i' }
      };
    }

    const total = await User.countDocuments(query);
    const users = await User.find(query).skip(skip).limit(limit);
    res.json({
      users: users || [],
      page,
      totalPages: Math.ceil(total / limit),
      totalUsers: total
    });
  } catch (err) {
    console.error("❌ Error fetching users:", err.message, err.stack);
    res.status(500).json({
      error: "Error fetching users",
      users: [],
      page: 1,
      totalPages: 1,
      totalUsers: 0
    });
  }
});

app.get("/api/users/:id", ensureAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    console.error("❌ Error fetching user:", err.message);
    res.status(500).json({ error: "Error fetching user" });
  }
});

app.post(
  "/api/users",
  ensureAdmin,
  [
    body("name").trim().notEmpty().withMessage("Name is required"),
    body("email").isEmail().withMessage("Invalid email address"),
    body("dob").isDate().withMessage("Invalid date of birth"),
    body("contact").matches(/^[0-9]{10}$/).withMessage("Contact must be a valid 10-digit number"),
    body("state").trim().notEmpty().withMessage("State is required"),
    body("country").trim().notEmpty().withMessage("Country is required"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    try {
      const { name, email, dob, contact, state, country } = req.body;
      const user = new User({ name, email, dob, contact, state, country });
      await user.save();
      res.status(201).json(user);
    } catch (err) {
      console.error("❌ Error creating user:", err.message);
      res.status(500).json({ error: err.message || "Error creating user" });
    }
  }
);

app.put(
  "/api/users/:id",
  ensureAdmin,
  [
    body("name").optional().trim().notEmpty().withMessage("Name is required"),
    body("email").optional().isEmail().withMessage("Invalid email address"),
    body("dob").optional().isDate().withMessage("Invalid date of birth"),
    body("contact").optional().matches(/^[0-9]{10}$/).withMessage("Contact must be a valid 10-digit number"),
    body("state").optional().trim().notEmpty().withMessage("State is required"),
    body("country").optional().trim().notEmpty().withMessage("Country is required"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    try {
      const { name, email, dob, contact, state, country } = req.body;
      const updateData = {};
      if (name) updateData.name = name;
      if (email) updateData.email = email;
      if (dob) updateData.dob = new Date(dob);
      if (contact) updateData.contact = contact;
      if (state) updateData.state = state;
      if (country) updateData.country = country;
      const user = await User.findByIdAndUpdate(req.params.id, updateData, { new: true });
      if (!user) return res.status(404).json({ error: "User not found" });
      res.json(user);
    } catch (err) {
      console.error("❌ Error updating user:", err.message);
      res.status(500).json({ error: err.message || "Error updating user" });
    }
  }
);

app.delete("/api/users/:id", ensureAdmin, async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.status(204).send();
  } catch (err) {
    console.error("❌ Error deleting user:", err.message);
    res.status(500).json({ error: "Error deleting user" });
  }
});

app.delete("/api/users", ensureAdmin, async (req, res) => {
  try {
    await User.deleteMany({});
    res.status(204).send();
  } catch (err) {
    console.error("❌ Error deleting all users:", err.message);
    res.status(500).json({ error: "Error deleting all users" });
  }
});

// Routes
app.get("/", (req, res) => {
  res.render("index", { error: null, success: null, validationMessage: null });
});

app.get("/about", (req, res) => {
  res.render("about");
});

app.post(
  "/submit",
  [
    body("name").trim().notEmpty().withMessage("Name is required"),
    body("email").isEmail().withMessage("Invalid email address"),
    body("dob").isDate().withMessage("Invalid date of birth"),
    body("contact").matches(/^[0-9]{10}$/).withMessage("Contact must be a valid 10-digit number"),
    body("state").trim().notEmpty().withMessage("State is required"),
    body("country").trim().notEmpty().withMessage("Country is required"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render("index", {
        error: errors.array().map((e) => e.msg).join(", "),
        success: null,
        validationMessage: null,
      });
    }
    try {
      const { name, email, dob, contact, state, country } = req.body;
      let validationMessage = null;
      try {
        const validationResult = await validateEmail(email);
        if (!validationResult.isValid) {
          return res.render("index", {
            error: validationResult.message,
            success: null,
            validationMessage: null,
          });
        }
        validationMessage = validationResult.message;
      } catch (err) {
        console.error("❌ Email validation failed:", err.message);
        validationMessage = "Validation unavailable";
      }
      await new User({ name, email, dob, contact, state, country, validationStatus: validationMessage }).save();
      res.render("index", { error: null, success: "Form submitted successfully!", validationMessage });
    } catch (err) {
      console.error("❌ Error saving user:", err.message);
      res.render("index", { error: `Server error: ${err.message}`, success: null, validationMessage: null });
    }
  }
);

app.get("/users", ensureAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;
    const total = await User.countDocuments();
    const users = await User.find().skip(skip).limit(limit);
    res.render("users", {
      users: users || [],
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("❌ Error loading users:", err.message);
    res.render("users", {
      users: [],
      page: 1,
      totalPages: 1,
      error: "Error loading users. Please try again.",
    });
  }
});

app.get("/create", ensureAdmin, (req, res) => {
  console.log("Reached /create route");
  try {
    res.render("create");
  } catch (err) {
    console.error("❌ Error rendering create page:", err.message);
    res.status(500).render("users", {
      users: [],
      page: 1,
      totalPages: 1,
      error: "Error loading create page",
    });
  }
});

app.get("/delete-all", ensureAdmin, async (req, res) => {
  try {
    await User.deleteMany({});
    console.log("✅ All users deleted successfully");
    res.redirect("/users");
  } catch (err) {
    console.error("❌ Error deleting all users:", err.message);
    res.render("users", {
      users: [],
      page: 1,
      totalPages: 1,
      error: "Error deleting all users",
    });
  }
});

app.get("/export", ensureAdmin, async (req, res) => {
  try {
    const users = await User.find();
    const fields = ["name", "email", "dob", "contact", "state", "country", "createdAt", "validationStatus"];
    const csv = json2csv(users.map((user) => user.toObject()), { fields });
    res.header("Content-Type", "text/csv");
    res.attachment("users.csv");
    res.send(csv);
  } catch (err) {
    console.error("❌ Error exporting CSV:", err.message);
    res.redirect("/users");
  }
});

app.get("/edit/:id", ensureAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      console.log(`User not found for ID: ${req.params.id}`);
      return res.redirect("/users");
    }
    console.log(`Rendering edit page for user: ${user.name}, ID: ${user._id}`);
    res.render("edit", { user, error: null });
  } catch (err) {
    console.error("❌ Error fetching user for edit:", err.message);
    res.redirect("/users");
  }
});

app.post(
  "/update/:id",
  ensureAdmin,
  [
    body("name").trim().notEmpty().withMessage("Name is required"),
    body("email").isEmail().withMessage("Invalid email address"),
    body("dob").isDate().withMessage("Invalid date of birth"),
    body("contact").matches(/^[0-9]{10}$/).withMessage("Contact must be a valid 10-digit number"),
    body("state").trim().notEmpty().withMessage("State is required"),
    body("country").trim().notEmpty().withMessage("Country is required"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).redirect("/users");
      return res.status(400).render("edit", {
        user,
        error: errors.array().map((e) => e.msg).join(", "),
      });
    }
    try {
      const { name, email, dob, contact, state, country } = req.body;
      let validationMessage = (await User.findById(req.params.id)).validationStatus;
      try {
        const validationResult = await validateEmail(email);
        if (!validationResult.isValid) {
          const user = await User.findById(req.params.id);
          return res.status(400).render("edit", {
            user,
            error: validationResult.message,
          });
        }
        validationMessage = validationResult.message;
      } catch (err) {
        console.error("❌ Email validation failed:", err.message);
        validationMessage = "Validation unavailable";
      }
      const updateData = {
        name,
        email,
        dob: new Date(dob),
        contact,
        state,
        country,
        validationStatus: validationMessage,
      };
      const user = await User.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true });
      if (!user) return res.status(404).redirect("/users");
      res.redirect("/users");
    } catch (err) {
      console.error("❌ Error updating user:", err.message);
      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).redirect("/users");
      res.status(500).render("edit", {
        user,
        error: `Failed to update user: ${err.message || "Internal server error"}`,
      });
    }
  }
);

app.get("/delete/:id", ensureAdmin, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.redirect("/users");
  } catch (err) {
    console.error("❌ Error deleting user:", err.message);
    res.redirect("/users");
  }
});

app.get("/dashboard", ensureAdmin, async (req, res) => {
  try {
    const users = await User.find();
    const totalUsers = users.length;

    let usersOverTime = { labels: [], data: [] };
    let usersByCountry = { labels: [], data: [] };
    let ageDistribution = { labels: [], data: [] };
    let topStates = { labels: [], data: [] };
    let recentUsers = [];

    if (totalUsers > 0) {
      const usersByYear = await User.aggregate([
        { $match: { createdAt: { $exists: true, $ne: null } } },
        { $group: { _id: { year: { $year: "$createdAt" } }, count: { $sum: 1 } } },
        { $sort: { "_id.year": 1 } }
      ]);
      usersOverTime = {
        labels: usersByYear.map(item => item._id.year.toString()),
        data: usersByYear.map(item => item.count)
      };

      const usersByCountryAgg = await User.aggregate([
        { $match: { country: { $exists: true, $ne: null } } },
        { $group: { _id: "$country", count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]);
      usersByCountry = {
        labels: usersByCountryAgg.map(item => item._id || "Unknown"),
        data: usersByCountryAgg.map(item => item.count)
      };

      const today = new Date();
      const ageDistributionAgg = await User.aggregate([
        { $match: { dob: { $exists: true, $ne: null } } },
        {
          $project: {
            age: {
              $floor: {
                $divide: [
                  { $subtract: [today, "$dob"] },
                  1000 * 60 * 60 * 24 * 365.25
                ]
              }
            }
          }
        },
        {
          $bucket: {
            groupBy: "$age",
            boundaries: [0, 18, 30, 45, 60, 120],
            default: "Other",
            output: { count: { $sum: 1 } }
          }
        }
      ]);
      ageDistribution = {
        labels: ageDistributionAgg.map(item =>
          item._id === "Other" ? "Other" : `${item._id}-${item._id + (item._id === 60 ? 60 : 14)}`
        ),
        data: ageDistributionAgg.map(item => item.count)
      };

      const mostCommonCountry = usersByCountryAgg[0]?._id || null;
      if (mostCommonCountry) {
        const topStatesAgg = await User.aggregate([
          { $match: { country: mostCommonCountry, state: { $exists: true, $ne: null } } },
          { $group: { _id: "$state", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 5 }
        ]);
        topStates = {
          labels: topStatesAgg.map(item => item._id || "Unknown"),
          data: topStatesAgg.map(item => item.count)
        };
      }

      recentUsers = await User.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .select("name email dob contact state country createdAt validationStatus");
    }

    console.log('Users Over Time:', JSON.stringify(usersOverTime, null, 2));
    console.log('Users by Country:', JSON.stringify(usersByCountry, null, 2));
    console.log('Age Distribution:', JSON.stringify(ageDistribution, null, 2));
    console.log('Top States:', JSON.stringify(topStates, null, 2));
    console.log('Recent Users:', JSON.stringify(recentUsers, null, 2));
    console.log('Total Users:', totalUsers);

    res.render("dashboard", {
      totalUsers,
      usersOverTime,
      usersByCountry,
      ageDistribution,
      topStates,
      recentUsers
    });
  } catch (err) {
    console.error("❌ Error loading dashboard:", err.message);
    res.render("admin", { error: "Error loading dashboard. Please try again." });
  }
});

app.use((req, res, next) => {
  if (typeof req.session.attempts === "undefined") req.session.attempts = 0;
  next();
});

app.get("/admin", (req, res) => {
  res.render("admin", { error: null });
});

app.post("/admin", (req, res) => {
  const { username, password } = req.body;

  if (req.session.attempts >= 3) {
    return res.render("admin", { error: "🚫 Too many failed attempts. Please try again later." });
  }

  if (username === ADMIN_USER && password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    req.session.attempts = 0;
    return res.redirect("/dashboard");
  } else {
    req.session.attempts += 1;
    return res.render("admin", { error: `❌ Invalid credentials. ${3 - req.session.attempts} attempts remaining.` });
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/admin");
  });
});

app.use((err, req, res, next) => {
  console.error("❌ Server error:", err.stack);
  res.status(500).render("index", {
    error: "Something went wrong on the server. Please try again later.",
    success: null,
    validationMessage: null,
  });
});

mongoose.connection.once("open", () => {
  app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
});

mongoose.connection.on("error", (err) => {
  console.error("❌ MongoDB connection error:", err.message);
});