const express = require("express");
const router = express.Router();
const { sequelize } = require("../config/database");
const { QueryTypes } = require("sequelize");
const { requireAdmin } = require("../middleware/requireAuth");

router.get("/", async (req, res) => {
  try {
    const { category } = req.query;

    let query = `
      SELECT sc.* 
      FROM subcategories sc
    `;
    const replacements = [];

    if (category) {
      query += " WHERE sc.category_id = ?";
      replacements.push(category);
    }

    query += " ORDER BY sc.order_index ASC"

    const subcategories = await sequelize.query(query, {
      type: QueryTypes.SELECT,
      replacements
    });

    res.json(subcategories);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch sub categories." });
  }
});

router.get("/photoSubcategories", async (req, res) => {
  try {
    let query = `
      SELECT 
        ps.photo_id, 
        s.id AS subcategory_id, 
        s.title
      FROM photo_subcategories ps
      INNER JOIN subcategories s ON ps.subcategory_id = s.id
    `;

    const rawRows = await sequelize.query(query, {
      type: QueryTypes.SELECT,
    });

    const formattedData = rawRows.reduce((acc, row) => {
      if (!acc[row.photo_id]) {
        acc[row.photo_id] = [];
      }
      
      acc[row.photo_id].push({
        id: row.subcategory_id,
        title: row.title
      });
      
      return acc;
    }, {});

    res.json(formattedData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch photo subcategories." });
  }
});

router.post("/", requireAdmin, async (req, res) => {
  try {
    const { category, title, order } = req.body;

    if (!category || !title) {
      return res.status(400).json({ message: "Category and title is required." });
    }

    const t = await sequelize.transaction();

    const [{ maxOrder }] = await sequelize.query(
        "SELECT COALESCE(MAX(order_index), -1) as maxOrder FROM subcategories WHERE category_id = ?",
        { replacements: [category], type: QueryTypes.SELECT, transaction: t }
      );

    const [result] = await sequelize.query(
      "INSERT INTO subcategories (category_id, title, order_index, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())",
      {
        replacements: [category, title, order ?? maxOrder + 1],
        type: QueryTypes.INSERT,
        transaction: t
      }
    );

    const subcategoryId = result;
    await t.commit();
    res.status(201).json({ message: "Subcategory added successfully.", id: subcategoryId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to add subcategory." });
  }
});

router.post("/:categoryId/reorder", requireAdmin, async(req, res) => {
  const { subcategories } = req.body;

  if (!Array.isArray(subcategories) || !subcategories.length) {
    return res.status(400).json({ message: "List of subcategories is required." });
  }

  const t = await sequelize.transaction();

  try {
    const currentSubcategories = await sequelize.query(
      "SELECT * FROM subcategories WHERE category_id = ?",
      { replacements: [req.params.categoryId], type: QueryTypes.SELECT, transaction: t }
    );
    
    const fetchedSubcategories = currentSubcategories.map(subcategory => subcategory.id);
    const editedSubcategories = new Set(subcategories.map(subcategory => subcategory.id));

    const isComparisonEqual = fetchedSubcategories.length === editedSubcategories.size 
    && fetchedSubcategories.every((val) => editedSubcategories.has(val));

    if(!isComparisonEqual) {
      await t.rollback();
      return res.status(400).json({ message: "Only subcategories for the requested category can be provided." });
    }

    for (let i = 0; i < subcategories.length; i++) {
      const { id, order_index } = subcategories[i];

      await sequelize.query(
        "UPDATE subcategories SET order_index = ?, updated_at = NOW() WHERE id = ?",
        { replacements: [order_index, id], type: QueryTypes.UPDATE, transaction: t }
      );
    }

    await t.commit();
    res.status(200).json({ message: "Subcategories successfully reordered." });
  } catch (error) {
    await t.rollback();
    console.error(error);
    res.status(500).json({ message: "Failed to order subcategories." });
  }
})

router.post("/bulk", requireAdmin, async (req, res) => {
  const { subcategories } = req.body;

  if (!Array.isArray(subcategories) || !subcategories.length) {
    return res.status(400).json({ message: "An array of subcategories is required." });
  }

  for (const item of subcategories) {
    if (!item.category || !item.title) {
      return res.status(400).json({ message: "Each subcategory needs a category and title." });
    }
  }

  const t = await sequelize.transaction();

  try {
    const byCategory = {};
    for (const item of subcategories) {
      (byCategory[item.category] ??= []).push(item);
    }

    const created = [];

    for (const [categoryId, items] of Object.entries(byCategory)) {
      const [{ maxOrder }] = await sequelize.query(
        "SELECT COALESCE(MAX(order_index), -1) as maxOrder FROM subcategories WHERE category_id = ?",
        { replacements: [categoryId], type: QueryTypes.SELECT, transaction: t }
      );

      for (let i = 0; i < items.length; i++) {
        const { title, order } = items[i];
        const finalOrder = order ?? maxOrder + 1 + i;

        const [result] = await sequelize.query(
          "INSERT INTO subcategories (category_id, title, order_index, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())",
          { replacements: [categoryId, title, finalOrder], type: QueryTypes.INSERT, transaction: t }
        );

        created.push({ id: result, title, category_id: categoryId, order_index: finalOrder });
      }
    }

    await t.commit();
    res.status(201).json({ message: "Subcategories added successfully.", created });
  } catch (error) {
    await t.rollback();
    console.error(error);
    res.status(500).json({ message: "Failed to add subcategories." });
  }
});

router.put("/:id", requireAdmin, async (req, res) => {
  try {
    const { category, title, views, order } = req.body;

    const [existing] = await sequelize.query(
      "SELECT * FROM subcategories WHERE id = ? LIMIT 1",
      { replacements: [req.params.id], type: QueryTypes.SELECT }
    );

    if (!existing) return res.status(404).json({ message: "Subcategory not found." });

    const categoryChanged = category !== existing.category_id;

    // guard: can't reassign this subcategory into the category it triggers
    if (categoryChanged && category) {
      const [triggeredCategory] = await sequelize.query(
        "SELECT id FROM categories WHERE trigger_subcategory_id = ? LIMIT 1",
        { replacements: [req.params.id], type: QueryTypes.SELECT }
      );

      if (triggeredCategory && triggeredCategory.id === category) {
        return res.status(400).json({ message: "This subcategory can't be assigned to the category it triggers." });
      }
    }

    let finalOrder = order ?? existing.order_index;

    if (categoryChanged) {
      const [{ maxOrder }] = await sequelize.query(
        "SELECT COALESCE(MAX(order_index), -1) as maxOrder FROM subcategories WHERE category_id " +
        (category ? "= ?" : "IS NULL"),
        { replacements: category ? [category] : [], type: QueryTypes.SELECT }
      );
      finalOrder = maxOrder + 1;
    }

    const updatedViews = existing.views + (views ?? 0);

    await sequelize.query(
      "UPDATE subcategories SET category_id = ?, title = ?, views = ?, order_index = ?, updated_at = NOW() WHERE id = ?",
      {
        replacements: [category ?? null, title, updatedViews, finalOrder, req.params.id],
        type: QueryTypes.UPDATE,
      }
    );

    res.json({ message: "Subcategory updated successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update subcategory." });
  }
});

router.delete("/:id", requireAdmin, async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const [existing] = await sequelize.query(
      "SELECT * FROM subcategories WHERE id = ? LIMIT 1",
      { replacements: [req.params.id], type: QueryTypes.SELECT, transaction: t }
    );

    if (!existing) {
      await t.rollback();
      return res.status(404).json({ message: "Subcategory not found." });
    }

    const [triggeredCategory] = await sequelize.query(
      "SELECT id, title FROM categories WHERE trigger_subcategory_id = ? LIMIT 1",
      { replacements: [req.params.id], type: QueryTypes.SELECT, transaction: t }
    );

    if (triggeredCategory && req.query.showConfirm) {
      await t.rollback();
      return res.status(409).json({
        message: `This subcategory triggers "${triggeredCategory.title}". Deleting it will make that category always visible. Confirm to proceed.`,
        triggeredCategory,
      });
    }

    await sequelize.query("DELETE FROM photo_subcategories WHERE subcategory_id = ?",
      { replacements: [req.params.id], type: QueryTypes.DELETE, transaction: t }
    );

    await sequelize.query("DELETE FROM subcategories WHERE id = ?",
      { replacements: [req.params.id], type: QueryTypes.DELETE, transaction: t }
    );

    await t.commit();
    res.json({ message: "Subcategory deleted successfully." });
  } catch (error) {
    await t.rollback();
    console.error(error);
    res.status(500).json({ message: "Failed to delete subcategory." });
  }
});

module.exports = router;