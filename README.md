# Raven's ♦️ Kandi API

API powering [Raven's Kandi](https://github.com/grinselln/ravens-kandi) — handles Google OAuth authentication, admin content management, and serves gallery data to the public site.

## Tech Stack
- MariaDB
- Express.js
- Node.js

## Project Setup

### Database Setup
Run `schema.sql` against your MariaDB instance to create the required tables.

### Running the Project
1. Clone the repo
2. `yarn install`
3. Copy `.env.example` to `.env` and fill in fields. A session secret can be acquired by `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
4. If running locally, open an SSH tunnel to the remote database (not needed in production, where the app runs on the same server as the DB):
   `ssh -p <host-port> -L 3307:localhost:3306 <your-cpanel-username>@<your-host> -N`
5. `yarn dev`