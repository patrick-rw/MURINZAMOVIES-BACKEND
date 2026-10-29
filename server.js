// backend/server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const Movie = require('./models/Movie');

const app = express();

// --- MIDDLEWARE ---
// Allow all origins so Vercel can talk to Render
app.use(cors()); 
// Parse incoming JSON data
app.use(express.json()); 

// --- DATABASE CONNECTION ---
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB Connected Successfully');
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error.message);
    process.exit(1); 
  }
};
connectDB();

// --- API ROUTES ---

// 1. Get all movies (with optional filters)
app.get('/api/movies', async (req, res) => {
  try {
    const { category, isTrending } = req.query;
    let query = {};
    if (category) query.category = category;
    if (isTrending) query.isTrending = isTrending === 'true';
    
    // Sort by newest first
    const movies = await Movie.find(query).sort({ createdAt: -1 });
    res.json(movies);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching movies' });
  }
});

// 2. Get a single movie by ID
app.get('/api/movies/:id', async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) return res.status(404).json({ error: 'Movie not found' });
    res.json(movie);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching movie' });
  }
});

// 3. Admin: Add a new movie
app.post('/api/movies', async (req, res) => {
  try {
    console.log("Incoming Data:", req.body); // Log to Render console
    const newMovie = new Movie(req.body);
    await newMovie.save();
    res.status(201).json(newMovie);
  } catch (err) {
    console.error("Error saving movie:", err);
    res.status(400).json({ error: err.message });
  }
});

// 4. Admin: Delete a movie
app.delete('/api/movies/:id', async (req, res) => {
  try {
    await Movie.findByIdAndDelete(req.params.id);
    res.json({ message: 'Movie deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error deleting movie' });
  }
});

// --- START SERVER ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
