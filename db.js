// db.js — MongoDB connection helper.
//
// Reads the connection string from the MONGODB_URI environment variable —
// never hardcode the actual URI (it contains your DB credentials).
//
// Locally: create a file named .env in this folder (same level as
// server.js) containing one line:
//   MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<dbname>
// (.env is already covered by the .gitignore below — never commit it.)
//
// On Render: set MONGODB_URI under your Web Service's Environment tab
// instead of a .env file.

const mongoose = require("mongoose");

async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.warn(
      "[db] MONGODB_URI not set — analytics will only log to the console, nothing will be saved to MongoDB."
    );
    return false;
  }

  try {
    await mongoose.connect(uri);
    console.log("[db] Connected to MongoDB");
    return true;
  } catch (err) {
    console.error("[db] MongoDB connection failed:", err.message);
    return false;
  }
}

module.exports = { connectDB };
