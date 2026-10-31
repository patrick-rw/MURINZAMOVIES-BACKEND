const mongoose = require('mongoose');

// A single link (watch or download). _id is disabled so links stay clean.
const LinkSchema = new mongoose.Schema(
  {
    quality: { type: String, trim: true, default: '' },
    url: { type: String, trim: true, required: true }
  },
  { _id: false }
);

const MovieSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    category: { type: String, required: true, trim: true, maxlength: 80 },
    genre: { type: String, trim: true, default: '', maxlength: 80 },
    posterUrl: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '', maxlength: 5000 },

    // FIX: downloadLinks was missing from the old schema, so Mongoose silently
    // dropped every download link on save. That is why the field was always blank.
    watchLinks: { type: [LinkSchema], default: [] },
    downloadLinks: { type: [LinkSchema], default: [] },

    isTrending: { type: Boolean, default: false },
    isSeason: { type: Boolean, default: false }
  },
  { timestamps: true }
);

MovieSchema.index({ createdAt: -1 });
MovieSchema.index({ category: 1 });

module.exports = mongoose.model('Movie', MovieSchema);
