# AVAI Football Database

A comprehensive football (soccer) data analysis platform with machine learning predictions, betting odds analysis, and value betting opportunities.

## Features

- **Fixtures Management**: Browse, filter, and analyze football matches with detailed statistics
- **Machine Learning Predictions**: TensorFlow-based MLP model for match outcome predictions
- **Value Analysis**: Identify betting value opportunities by comparing bookmaker odds
- **Real-time Odds Streaming**: Live betting odds updates via streaming APIs
- **Expected Goals (xG) Integration**: Multiple xG data sources (API-Football, Sofascore, Flashlive)
- **Admin Dashboard**: League management, data fetching, ML model training, and betting simulations

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment:**
   Create `.env.local` with required database and API credentials:
   ```
   DB_USER=your_db_user
   DB_PASSWORD=your_db_password
   DB_HOST=your_db_host
   DB_PORT=port
   DB_NAME=your_db_name
   DB_SSL=false
   ```

3. **Run the application:**
   ```bash
   npm run dev
   ```
   The app runs on `http://localhost:3005`

## Main Sections

- **Fixtures**: Browse matches, view statistics, lineups, and odds
- **Values**: Analyze betting value opportunities across bookmakers
- **Admin**: Manage leagues, fetch data, train ML models, run simulations

## Documentation

- [API Documentation](API_DOCUMENTATION.md) - Complete API reference
- [Database Schema](schema.sql) - PostgreSQL database structure

## Tech Stack

- **Frontend**: Next.js 14, React, Tailwind CSS
- **Backend**: Next.js API Routes
- **Database**: PostgreSQL
- **ML**: TensorFlow.js with custom MLP neural networks
- **Data Sources**: Multiple football APIs (API-Football, Sofascore, Flashlive) and betting APIs