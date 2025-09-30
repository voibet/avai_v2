## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env.local` file in the root directory with your database credentials and API keys:

   Required environment variables:
   ```
   DB_USER=your_db_user
   DB_PASSWORD=your_db_password
   DB_HOST=your_db_host
   DB_PORT=port
   DB_NAME=your_db_name
   DB_SSL=false
   ```

3. Run the development server:
```bash
npm run dev
```

## XG Data Sources

The application supports fetching Expected Goals (XG) data from three different sources:

### 1. Native (API-Football)
- Uses the same API as fixtures
- Set XG source URL to `NATIVE` in league configuration
- Fetches XG data directly from API-Football fixture statistics

### 2. Sofascore
- Uses tournament and season ID format: `tournamentId-seasonId` (e.g., `22-74091`)
- Requires RapidAPI subscription for Sofascore endpoints
- Fetches data from Sofascore's tournaments and match statistics APIs

### 3. Flashlive
- Uses tournament stage ID format (e.g., `e98d763a`)
- Requires RapidAPI subscription for Flashlive endpoints  
- Fetches data from Flashlive's tournaments results and event statistics APIs

### Usage

1. **Configure XG Sources**: In the admin panel, use "Manage xG" to set up XG data sources for each league
2. **Fetch XG for League**: Click "Fetch xG" next to any league to fetch missing XG data for that league
3. **Fetch All XG**: Click "Fetch All XG" to fetch missing XG data for all configured leagues

The system automatically matches fixtures between different APIs using:
- Match scores
- Start time (±1 hour window)  
- Smart team name matching: exact matches with stored team mappings first, then fuzzy matching
- Matches are automatically scoped to the correct league/season from the xg_source configuration

### Requirements

- All three XG source APIs require RapidAPI subscriptions
- Rate limiting: 5 requests per second (200ms between requests) across all XG API endpoints
- Intelligent caching: Tournament data is fetched once per league/season and cached for all fixtures
- Smart Pagination: Automatically searches up to 10 pages with intelligent early termination (stops when enough matches found, on duplicates, fewer results, or empty pages)
- Processes multiple fixtures sequentially with optimized API usage
- XG data is only fetched for finished matches (status: AET, FT, PEN) that don't already have XG data
- Only processes fixtures from seasons marked as `current=true` in the league configuration