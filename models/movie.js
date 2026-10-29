const mongoose = require('mongoose');

const MovieSchema = new mongoose.Schema({
  title: { type: String, required: true },
  category: { type: String, required: true },
  genre: { type: String },
  posterUrl: { type: String, required: true },
  description: { type: String },
  watchLinks: [
    {
      quality: String,
      url: String
    }
  ],
  isTrending: { type: Boolean, default: false },
  isSeason: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Movie', MovieSchema);