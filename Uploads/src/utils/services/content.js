const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const { authRequired, adminRequired } = require('../middleware/auth');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../../uploads')),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /jpeg|jpg|png|webp|gif/.test(file.mimetype);
    cb(ok ? null : new Error('Only image files are allowed'), ok);
  },
});

// ---------- EDUCATION (public read) ----------
router.get('/education', async (req, res) => {
  const { category } = req.query;
  const params = [];
  let where = 'WHERE published=TRUE';
  if (category) { params.push(category); where += ` AND category=$${params.length}`; }
  const result = await db.query(`SELECT * FROM education_articles ${where} ORDER BY created_at DESC`, params);
  res.json(result.rows);
});

router.get('/education/:slug', async (req, res) => {
  const result = await db.query('SELECT * FROM education_articles WHERE slug=$1 AND published=TRUE', [req.params.slug]);
  if (!result.rows.length) return res.status(404).json({ error: 'Article not found' });
  res.json(result.rows[0]);
});

router.post('/education', authRequired, adminRequired, async (req, res) => {
  const { title, slug, category, content, cover_image_url, published = true } = req.body;
  const result = await db.query(
    `INSERT INTO education_articles (title, slug, category, content, cover_image_url, published)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [title, slug, category, content, cover_image_url, published]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/education/:id', authRequired, adminRequired, async (req, res) => {
  const { title, category, content, cover_image_url, published } = req.body;
  const result = await db.query(
    `UPDATE education_articles SET title=COALESCE($1,title), category=COALESCE($2,category),
     content=COALESCE($3,content), cover_image_url=COALESCE($4,cover_image_url),
     published=COALESCE($5,published) WHERE id=$6 RETURNING *`,
    [title, category, content, cover_image_url, published, req.params.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Article not found' });
  res.json(result.rows[0]);
});

router.delete('/education/:id', authRequired, adminRequired, async (req, res) => {
  await db.query('DELETE FROM education_articles WHERE id=$1', [req.params.id]);
  res.json({ message: 'Article deleted' });
});

// ---------- MEDIA ASSETS (admin uploads real images for site sections) ----------
router.post('/media/upload', authRequired, adminRequired, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { section, label } = req.body;
  const fileUrl = `/uploads/${req.file.filename}`;
  const result = await db.query(
    `INSERT INTO media_assets (uploaded_by, file_url, section, label) VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.user.id, fileUrl, section || 'misc', label || null]
  );
  res.status(201).json(result.rows[0]);
});

router.get('/media', async (req, res) => {
  const { section } = req.query;
  const params = [];
  let where = '';
  if (section) { params.push(section); where = `WHERE section=$1`; }
  const result = await db.query(`SELECT * FROM media_assets ${where} ORDER BY created_at DESC`, params);
  res.json(result.rows);
});

router.delete('/media/:id', authRequired, adminRequired, async (req, res) => {
  await db.query('DELETE FROM media_assets WHERE id=$1', [req.params.id]);
  res.json({ message: 'Asset deleted' });
});

module.exports = router;
