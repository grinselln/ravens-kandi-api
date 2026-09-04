const express = require("express");
const router = express.Router();
const { sequelize } = require("../config/database");
const { QueryTypes } = require("sequelize");
const { upload, processAndSaveImage, deleteImageFile } = require("../config/multer");
const { requireAdmin } = require("../middleware/requireAuth");
const viewLimiter = require("../middleware/viewLimiter");

const isProd = process.env.NODE_ENV === "development" ? 0 : 1;

router.post("/", async (req, res) => {
  try {
    const { type, filters } = req.body;

    const replacements = [];

    let query = `
      SELECT p.*, pt.title as type_title
      FROM photos p
      LEFT JOIN photo_types pt ON p.photo_type_id = pt.id
      WHERE p.isProd = ?
    `;
    replacements.push(isProd);
    

    if (type) {
      const types = Array.isArray(type) ? type : [type];
      query += ` AND p.photo_type_id IN (?)`;
      replacements.push(types);
    }

    for (const [idx, filter] of (filters ?? []).entries()) {
      if (idx === 0) query += ` AND`;

      const hasSubcategories = filter.subcategory_ids.length > 0;

      query += ` EXISTS (
        SELECT 1 
        FROM photo_subcategories ps
        JOIN subcategories s ON s.id = ps.subcategory_id
        WHERE ps.photo_id = p.id
          AND s.category_id = ?
          ${hasSubcategories ? `AND ps.subcategory_id IN (?)` : ``}
      )`;

      if (idx !== filters.length - 1) query += ` AND`

      replacements.push(filter.category_id);

      hasSubcategories && replacements.push(filter.subcategory_ids);
    };

    query += " ORDER BY p.created_at DESC";

    const photos = await sequelize.query(query, {
      replacements,
      type: QueryTypes.SELECT,
    });

    const photoIds = photos.map((p) => p.id);

    const categoryRows = await sequelize.query(
      `
      SELECT 
        pc.photo_id,
        c.id AS category_id,
        c.title AS category_name,
        c.order_index AS category_order_index,
        NULL AS subcategory_id,
        NULL AS subcategory_name,
        NULL AS subcategory_order_index
      FROM photo_categories pc
      JOIN categories c ON c.id = pc.category_id
      ${photoIds.length > 0 ? `WHERE pc.photo_id IN (?)` : ``}

      UNION ALL

      SELECT
        ps.photo_id,
        c.id AS category_id,
        c.title AS category_name,
        c.order_index AS category_order_index,
        s.id AS subcategory_id,
        s.title AS subcategory_name,
        s.order_index AS subcategory_order_index
      FROM photo_subcategories ps
      JOIN subcategories s ON s.id = ps.subcategory_id
      JOIN categories c ON c.id = s.category_id
      ${photoIds.length > 0 ? `WHERE ps.photo_id IN (?)` : ``}

      ORDER BY category_order_index ASC, subcategory_order_index ASC
      `,
      {
        replacements: photoIds.length > 0 ? [photoIds, photoIds]: [],
        type: QueryTypes.SELECT,
      }
    );

    // Group flat rows into { [photo_id]: [{ category_name, subcategory_names }] }
    const categoriesByPhoto = {};

    for (const row of categoryRows) {
      if (!categoriesByPhoto[row.photo_id]) {
        categoriesByPhoto[row.photo_id] = new Map();
      }
      const photoCategoryMap = categoriesByPhoto[row.photo_id];

      if (!photoCategoryMap.has(row.category_id)) {
        photoCategoryMap.set(row.category_id, {
          category_name: row.category_name,
          subcategory_names: [],
        });
      }

      if (row.subcategory_name) {
        photoCategoryMap.get(row.category_id).subcategory_names.push(row.subcategory_name);
      }
    }

    const photosWithCategories = photos.map((photo) => {
      return ({
      ...photo,
      categories: categoriesByPhoto[photo.id]
        ? Array.from(categoriesByPhoto[photo.id].values())
        : [],
    })});

    res.json(photosWithCategories);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch photos." });
  }
});

router.post("/admin", async (req, res) => {
  try {
    const { type, filters, missingType, missingCategory, missingSubcategory, sort } = req.body;
    const replacements = [];

    let query = `
      SELECT p.*, pt.title as type_title,
        CASE WHEN p.photo_type_id IS NULL THEN true ELSE false END AS missing_type,
        CASE WHEN NOT EXISTS (SELECT 1 FROM photo_categories pc WHERE pc.photo_id = p.id) THEN true ELSE false END AS missing_category,
        CASE WHEN NOT EXISTS (SELECT 1 FROM photo_subcategories ps WHERE ps.photo_id = p.id) THEN true ELSE false END AS missing_subcategory
      FROM photos p
      LEFT JOIN photo_types pt ON p.photo_type_id = pt.id
      WHERE p.isProd = ?
    `;
    replacements.push(isProd);
    
    if (type) {
      const types = Array.isArray(type) ? type : [type];
      query += ` AND p.photo_type_id IN (?)`;
      replacements.push(types);
    }

    for (const [idx, filter] of (filters ?? []).entries()) {
      if (idx === 0) query += ` AND`;

      const hasSubcategories = filter.subcategory_ids.length > 0;

      query += ` EXISTS (
        SELECT 1 
        FROM photo_subcategories ps
        JOIN subcategories s ON s.id = ps.subcategory_id
        WHERE ps.photo_id = p.id
        AND s.category_id = ?
        ${hasSubcategories ? `AND ps.subcategory_id IN (?)` : ``}
      )`;

      if (idx !== filters.length - 1) query += ` AND`

      replacements.push(filter.category_id,);

      hasSubcategories && replacements.push(filter.subcategory_ids);;
    };

    const missingConditions = [];
    if (missingType) missingConditions.push("p.photo_type_id IS NULL");
    if (missingCategory) missingConditions.push("NOT EXISTS (SELECT 1 FROM photo_categories pc WHERE pc.photo_id = p.id)");
    if (missingSubcategory) missingConditions.push("NOT EXISTS (SELECT 1 FROM photo_subcategories ps WHERE ps.photo_id = p.id)");

    if (missingConditions.length) {
      query += ` AND (${missingConditions.join(" OR ")})`;
    }

    switch (sort) {
      case "alpha":
        query += " ORDER BY p.title ASC";
        break;
      case "viewsA":
        query += " ORDER BY p.views ASC";
        break;
      case "viewsD":
        query += " ORDER BY p.views DESC";
        break;
      default:
        query += " ORDER BY p.created_at DESC";
    }

    const photos = await sequelize.query(query, {
      replacements,
      type: QueryTypes.SELECT,
    });

    res.json(photos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch photos." });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const [photo] = await sequelize.query(
      "SELECT * FROM photos WHERE id = ? LIMIT 1",
      {
        replacements: [req.params.id],
        type: QueryTypes.SELECT,
      }
    );

    if (!photo) return res.status(404).json({ message: "Photo not found." });

    res.json(photo);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch photo." });
  }
});

router.get("/filters", async (req, res) => {
  try {
    const types = await sequelize.query(`
      SELECT pt.id, pt.title FROM photo_types pt
      WHERE EXISTS (SELECT 1 FROM photos p WHERE p.photo_type_id = pt.id)
      ORDER BY pt.order_index
    `, { type: QueryTypes.SELECT });

    const categories = await sequelize.query(`
      SELECT c.id, c.title, c.trigger_subcategory_id FROM categories c
      WHERE EXISTS (SELECT 1 FROM photo_categories pc WHERE pc.category_id = c.id)
      ORDER BY c.order_index
    `, { type: QueryTypes.SELECT });

    const subcategories = await sequelize.query(`
      SELECT s.id, s.category_id, s.title FROM subcategories s
      WHERE EXISTS (SELECT 1 FROM photo_subcategories ps WHERE ps.subcategory_id = s.id)
      ORDER BY s.order_index
    `, { type: QueryTypes.SELECT });

    res.json({ types, categories, subcategories });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch filters." });
  }
});

async function validateCategorySelection(categoryList, subcategoryList, transaction) {
  if (subcategoryList.length === 0) return null;

  const rows = await sequelize.query(
    `SELECT s.id as subcategory_id, s.category_id, c.trigger_subcategory_id
     FROM subcategories s
     JOIN categories c ON c.id = s.category_id
     WHERE s.id IN (?)`,
    { replacements: [subcategoryList], type: QueryTypes.SELECT, transaction }
  );

  if (rows.length !== subcategoryList.length) {
    return "One or more subcategories do not exist.";
  }

  for (const row of rows) {
    if (!categoryList.includes(row.category_id)) {
      return `Subcategory ${row.subcategory_id} requires its parent category (${row.category_id}) to be selected.`;
    }
    if (row.trigger_subcategory_id && !subcategoryList.includes(row.trigger_subcategory_id)) {
      return `Subcategory ${row.subcategory_id} requires trigger subcategory ${row.trigger_subcategory_id} to be selected first.`;
    }
  }

  return null;
}

router.post("/new", requireAdmin, upload.single("image"), async (req, res) => {
  const t = await sequelize.transaction();
  let filename = null;

  try {
    const { title, story, source, photo_type_id, categories, subcategories } = req.body;

    if (!req.file) {
      await t.rollback();
      return res.status(400).json({ message: "An image is required." });
    }

    const categoryList = categories
      ? (Array.isArray(categories) ? categories : [categories]).map(Number)
      : [];
    const subcategoryList = subcategories
      ? (Array.isArray(subcategories) ? subcategories : [subcategories]).map(Number)
      : [];

    const validationError = await validateCategorySelection(categoryList, subcategoryList, t);
    if (validationError) {
      await t.rollback();
      return res.status(400).json({ message: validationError });
    }

    filename = await processAndSaveImage(req.file.buffer, req.file.originalname);

    const [photoId] = await sequelize.query(
      "INSERT INTO photos (photo_type_id, photo_filename, title, story, source, created_by, created_at, updated_at, isProd) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW(), ?)",
      {
        replacements: [photo_type_id || null, filename, title, story, source, req.user.id, isProd],
        type: QueryTypes.INSERT,
        transaction: t,
      }
    );

    for (const categoryId of categoryList) {
      await sequelize.query(
        "INSERT INTO photo_categories (photo_id, category_id) VALUES (?, ?)",
        { replacements: [photoId, categoryId], type: QueryTypes.INSERT, transaction: t }
      );
    }

    for (const subcategoryId of subcategoryList) {
      await sequelize.query(
        "INSERT INTO photo_subcategories (photo_id, subcategory_id) VALUES (?, ?)",
        { replacements: [photoId, subcategoryId], type: QueryTypes.INSERT, transaction: t }
      );
    }

    await t.commit();
    res.status(201).json({ message: "Photo uploaded successfully.", id: photoId });
  } catch (error) {
    await t.rollback();
    if (filename) {
      await deleteImageFile(filename).catch((cleanupErr) =>
        console.error("Failed to clean up orphaned file:", filename, cleanupErr)
      );
    }
    console.error(error);
    res.status(500).json({ message: "Failed to upload photo." });
  }
});

router.put("/:id", requireAdmin, upload.single("image"), async (req, res) => {
  const t = await sequelize.transaction();
  let newFilename = null;
  let oldFilenameToDelete = null;

  try {
    const { title, story, source, photo_type_id, categories, subcategories } = req.body;

    const [existing] = await sequelize.query(
      "SELECT * FROM photos WHERE id = ? LIMIT 1",
      { replacements: [req.params.id], type: QueryTypes.SELECT, transaction: t }
    );

    if (!existing) {
      await t.rollback();
      return res.status(404).json({ message: "Photo not found." });
    }

    const categoryList = categories
      ? (Array.isArray(categories) ? categories : [categories]).map(Number)
      : [];
    const subcategoryList = subcategories
      ? (Array.isArray(subcategories) ? subcategories : [subcategories]).map(Number)
      : [];

    const validationError = await validateCategorySelection(categoryList, subcategoryList, t);
    if (validationError) {
      await t.rollback();
      return res.status(400).json({ message: validationError });
    }

    let filename = existing.photo_filename;

    if (req.file) {
      newFilename = await processAndSaveImage(req.file.buffer, req.file.originalname);
      filename = newFilename;
      oldFilenameToDelete = existing.photo_filename;
    }

    await sequelize.query(
      "UPDATE photos SET photo_type_id = ?, photo_filename = ?, title = ?, story = ?, source = ?, updated_at = NOW() WHERE id = ?",
      {
        replacements: [photo_type_id, filename, title, story || null, source || null, req.params.id],
        type: QueryTypes.UPDATE,
        transaction: t,
      }
    );

    if (categories) {
      await sequelize.query("DELETE FROM photo_categories WHERE photo_id = ?", {
        replacements: [req.params.id],
        type: QueryTypes.DELETE,
        transaction: t,
      });
      for (const categoryId of categoryList) {
        await sequelize.query(
          "INSERT INTO photo_categories (photo_id, category_id) VALUES (?, ?)",
          { replacements: [req.params.id, categoryId], type: QueryTypes.INSERT, transaction: t }
        );
      }
    }

    if (subcategories) {
      await sequelize.query("DELETE FROM photo_subcategories WHERE photo_id = ?", {
        replacements: [req.params.id],
        type: QueryTypes.DELETE,
        transaction: t,
      });
      for (const subcategoryId of subcategoryList) {
        await sequelize.query(
          "INSERT INTO photo_subcategories (photo_id, subcategory_id) VALUES (?, ?)",
          { replacements: [req.params.id, subcategoryId], type: QueryTypes.INSERT, transaction: t }
        );
      }
    }

    await t.commit();

    if (oldFilenameToDelete) {
      await deleteImageFile(oldFilenameToDelete).catch((cleanupErr) =>
        console.error("Failed to clean up replaced file:", oldFilenameToDelete, cleanupErr)
      );
    }
    res.json({ message: "Photo updated successfully." });
  } catch (error) {
    await t.rollback();
    if (newFilename) {
      await deleteImageFile(newFilename).catch((cleanupErr) =>
        console.error("Failed to clean up orphaned file:", newFilename, cleanupErr)
      );
    }
    console.error(error);
    res.status(500).json({ message: "Failed to update photo." });
  }
});

router.patch("/:id/views", viewLimiter, async (req, res) => {
  const [results, metadata] = await sequelize.query(
    "UPDATE photos SET views = views + 1, updated_at = NOW() WHERE id = ?",
    {
      replacements: [req.params.id],
      type: QueryTypes.UPDATE,
    }
  );

  if (metadata.affectedRows === 0) return res.status(404).json({ message: "Photo not found." });

  res.json({ message: "Photo views updated successfully." });
})

router.delete("/:id", requireAdmin, async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const [existing] = await sequelize.query(
      "SELECT * FROM photos WHERE id = ? LIMIT 1",
      { replacements: [req.params.id], type: QueryTypes.SELECT, transaction: t }
    );

    if (!existing) {
      await t.rollback();
      return res.status(404).json({ message: "Photo not found." });
    }

    await sequelize.query("DELETE FROM photo_categories WHERE photo_id = ?", {
      replacements: [req.params.id],
      type: QueryTypes.DELETE,
      transaction: t,
    });
    await sequelize.query("DELETE FROM photo_subcategories WHERE photo_id = ?", {
      replacements: [req.params.id],
      type: QueryTypes.DELETE,
      transaction: t,
    });
    await sequelize.query("DELETE FROM photos WHERE id = ?", {
      replacements: [req.params.id],
      type: QueryTypes.DELETE,
      transaction: t,
    });

    await deleteImageFile(existing.photo_filename).catch((cleanupErr) =>
      console.error("Failed to clean up deleted photo file:", existing.photo_filename, cleanupErr)
    );

    await t.commit();
    res.json({ message: "Photo deleted successfully." });
  } catch (error) {
    await t.rollback();
    console.error(error);
    res.status(500).json({ message: "Failed to delete photo." });
  }
});

module.exports = router;