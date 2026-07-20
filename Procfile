# Used by Railway/Heroku-style platforms to run two processes from one repo.
# On Railway: create two services from this same repo, set each one's
# "Custom Start Command" to the matching line below (Railway doesn't read
# Procfiles automatically the way Heroku does), and give both services the
# exact same DATABASE_URL and ENCRYPTION_KEY env vars.
web: npm start
worker: npm run engine
