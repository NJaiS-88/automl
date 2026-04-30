const mongoose = require("mongoose");

async function connectDb(mongoUri) {
  if (!mongoUri) {
    throw new Error("MONGODB_URI is missing. Add it to backend/.env");
  }
  await mongoose.connect(mongoUri);
}

module.exports = { connectDb };
