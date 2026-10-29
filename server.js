const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const Movie = require('./models/Movie');

const app = express();

// Middleware
// Allow requests from your Vercel frontend and local testing
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:5500', 'https://your-vercel-app.vercel.app'] 
  // 👆 REPLACE 'https://your-vercel-app.vercel.app' with your actual Vercel URL
}));
app.use(express.json());

// Connect to MongoDB (Fail fast)
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB Connected Successfully');
  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err.message);
    process.exit(1); // Stop the server if DB fails
  }
};
connectDB();

// --- API ROUTES ---

// 1. Get all movies (Supports ?isTrending=true filter)
app.get('/api/movies', async (req, res) => {
  try {
    let query = {};
    if (req.query.isTrending) {
      query.isTrending = req.query.isTrending === 'true';
    }
    if (req.query.category) {
      query.category = req.query.category;
    }

    const movies = await Movie.find(query).sort({ createdAt: -1 });
    res.json(movies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Get single movie by ID (CRITICAL for movie.html page)
app.get('/api/movies/:id', async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) return res.status(404).json({ message: 'Movie not found' });
    res.json(movie);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Add a new movie (for admin panel)
app.post('/api/movies', async (req, res) => {
  try {
    const newMovie = new Movie(req.body);
    await newMovie.save();
    res.status(201).json({ message: 'Movie added successfully', movie: newMovie });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 4. Delete a movie (for admin panel)
app.delete('/api/movies/:id', async (req, res) => {
  try {
    await Movie.findByIdAndDelete(req.params.id);
    res.json({ message: 'Movie deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
