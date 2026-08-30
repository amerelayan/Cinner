# Cinner

Cinner is a movie discovery and tracking application. Its defining feature is a personalized movie recommendation system that learns each user's taste and recommends movies specifically for them.

Cinner learns from:

- The user's 5 favorite movies (chosen during onboarding, changeable anytime)
- Movies the user has rated (1–10, in 0.5 increments)
- Movies the user has marked as watched
- Movies in the user's watchlist

For each recommended movie, Cinner shows:

- A **Match %** — how well the movie fits the user's learned preferences
- A **Predicted Rating** — Cinner's prediction of what the user would personally rate the movie

Cinner also provides:

- A relevant, IMDb-style movie search
- Movie detail pages (poster, title, release year, IMDb/Rotten Tomatoes/Letterboxd ratings, synopsis, director, cast, genres, language)
- The ability to rate movies, mark them watched, and manage a watchlist
- A simple user profile (profile picture, 5 favorite movies, watched movies, watchlist)

## Architecture

- **Frontend:** Next.js + React
- **Backend:** FastAPI (Python) — contains all application logic, including the recommendation engine
- **Database & Auth:** Supabase (hosted PostgreSQL, email/password and Google authentication)
- **Movie data:** TMDB (metadata, posters, search)

Data flow: `Next.js → FastAPI → Supabase PostgreSQL`. Authentication: `Next.js → Supabase Auth → token → FastAPI verifies token`. The frontend does not access the database directly.

## Status

This project is in early setup. No application code has been written yet.
