const express = require("express");
const router = express.Router();
const { sequelize } = require("../config/database");
const { QueryTypes } = require("sequelize");
const { requireAdmin } = require("../middleware/requireAuth");

const isProd = process.env.NODE_ENV === "development" ? 0 : 1;

router.get("/", async (req, res) => {
  try {
    const categories = await sequelize.query(
      `SELECT 
      c.*,
      EXISTS(SELECT 1 FROM photo_categories pc JOIN photos p ON p.id = pc.photo_id WHERE pc.category_id = c.id AND p.isProd = ?) AS category_has_photo,
      sc.id as subcategory_id, 
      sc.title as subcategory_title, 
      sc.order_index as subcategory_order,
      EXISTS(SELECT 1 FROM photo_subcategories ps JOIN photos p ON p.id = ps.photo_id WHERE ps.subcategory_id = sc.id AND p.isProd = ?) AS subcategory_has_photo
      FROM categories c
      LEFT JOIN subcategories sc ON sc.category_id = c.id
      ORDER BY c.order_index ASC, sc.order_index ASC`,
      { replacements: [isProd, isProd], type: QueryTypes.SELECT }
    );

    const grouped = new Map();
    const groupedOnlyPhotos = new Map();
    
    for (const row of categories) {
      if (!grouped.has(row.id)) {
        grouped.set(row.id, {
          id: row.id,
          title: row.title,
          trigger_subcategory_id: row.trigger_subcategory_id,
          order_index: row.order_index,
          created_at: row.created_at,
          subcategories: [],
        });
      }
      
      if (row.category_has_photo && !groupedOnlyPhotos.has(row.id)) {
        groupedOnlyPhotos.set(row.id, {
          id: row.id,
          title: row.title,
          trigger_subcategory_id: row.trigger_subcategory_id,
          order_index: row.order_index,
          created_at: row.created_at,
          subcategories: [],
        });
      }

      if (row.subcategory_id) {
        grouped.get(row.id).subcategories.push({
          id: row.subcategory_id,
          title: row.subcategory_title,
          order_index: row.subcategory_order
        });
      }

      if(row.subcategory_id && row.subcategory_has_photo && groupedOnlyPhotos.get(row.id)) {   
        groupedOnlyPhotos.get(row.id).subcategories.push({
          id: row.subcategory_id,
          title: row.subcategory_title,
          order_index: row.subcategory_order
        });
      }
    }

    const groupedCategories = Array.from(grouped.values());
    const groupedCategoriesPhotosOnly = Array.from(groupedOnlyPhotos.values());

    let triggerSubcategories = {}

    groupedCategories.forEach(category => {
      if(category.trigger_subcategory_id) {
        triggerSubcategories[category.trigger_subcategory_id] = {
          triggered_category_id: category.id,
          triggered_category_title: category.title
        }
      }
    });

    groupedCategoriesPhotosOnly.forEach(category => {
      if(category.trigger_subcategory_id) {
        triggerSubcategories[category.trigger_subcategory_id] = {
          triggered_category_id: category.id,
          triggered_category_title: category.title
        }
      }
    });

    const options = groupedCategories.flatMap(category =>
      category.subcategories.map(sub => ({
        id: sub.id,
        category_id: category.id,
        trigger_details: triggerSubcategories[sub.id],
        label: `${sub.title} (${category.title})`
      }))
    );

    res.json({ groupedCategories, groupedCategoriesPhotosOnly, groupedCategoriesMap: Object.fromEntries(grouped), options });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch categories." });
  }
});

router.get("/photoCategories", async (req, res) => {
  try {
    let query = "SELECT pc.photo_id, c.id AS category_id, c.title FROM photo_categories pc INNER JOIN categories c ON pc.category_id = c.id";


    const rawRows = await sequelize.query(query, {
      type: QueryTypes.SELECT,
    });

    const formattedData = rawRows.reduce((acc, row) => {
      if (!acc[row.photo_id]) {
        acc[row.photo_id] = [];
      }
      
      acc[row.photo_id].push({
        id: row.category_id,
        title: row.title
      });
      
      return acc;
    }, {});

    res.json(formattedData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch photo categories." });
  }
});

router.post("/", requireAdmin, async (req, res) => {
  const { title, subcategoryIds = [], newSubcategoryTitles = [], triggerSubcategoryId } = req.body;

  const t = await sequelize.transaction();

  try {
    if (triggerSubcategoryId && subcategoryIds.includes(triggerSubcategoryId)) {
      await t.rollback();
      return res.status(400).json({ message: "Trigger subcategory can't belong to the category it triggers." });
    }

    const [{ maxOrder }] = await sequelize.query(
      "SELECT COALESCE(MAX(order_index), -1) as maxOrder FROM categories",
      { type: QueryTypes.SELECT, transaction: t }
    );

    const [categoryId] = await sequelize.query(
      `INSERT INTO categories (title, order_index, trigger_subcategory_id) VALUES (?, ?, ?)`,
      {
        replacements: [title, maxOrder + 1, triggerSubcategoryId || null],
        type: QueryTypes.INSERT,
        transaction: t,
      }
    );

    if (subcategoryIds.length) {
      const [{ maxSubOrder }] = await sequelize.query(
        "SELECT COALESCE(MAX(order_index), -1) as maxSubOrder FROM subcategories WHERE category_id = ?",
        { replacements: [categoryId], type: QueryTypes.SELECT, transaction: t }
      );

      for (let i = 0; i < subcategoryIds.length; i++) {
        await sequelize.query(
          "UPDATE subcategories SET category_id = ?, order_index = ? WHERE id = ?",
          { replacements: [categoryId, maxSubOrder + 1 + i, subcategoryIds[i]], transaction: t }
        );
      }
    }

    for (let i = 0; i < newSubcategoryTitles.length; i++) {
      await sequelize.query(
        "INSERT INTO subcategories (title, category_id, order_index) VALUES (?, ?, ?)",
        { replacements: [newSubcategoryTitles[i], categoryId, subcategoryIds.length + i], transaction: t }
      );
    }

    await t.commit();
    res.status(201).json({ id: categoryId, title });
  } catch (error) {
    await t.rollback();
    console.error(error);
    res.status(500).json({ message: "Failed to create category." });
  }
});

router.post("/reorder", requireAdmin, async(req, res) => {
  const { categories } = req.body;

  if (!Array.isArray(categories) || !categories.length) {
    return res.status(400).json({ message: "List of categories is required." });
  }

  const t = await sequelize.transaction();

  try {
    for (let i = 0; i < categories.length; i++) {
      const { id, order_index } = categories[i];

      await sequelize.query(
        "UPDATE categories SET order_index = ?, updated_at = NOW() WHERE id = ?",
        { replacements: [order_index, id], type: QueryTypes.UPDATE, transaction: t }
      );
    }

    await t.commit();
    res.status(200).json({ message: "Categories successfully reordered." });
  } catch (error) {
    await t.rollback();
    console.error(error);
    res.status(500).json({ message: "Failed to order categories." });
  }
})

router.put("/:id", requireAdmin, async (req, res) => {
  try {
    const { title, order, triggerSubcategoryId, views } = req.body;

    const [existing] = await sequelize.query(
      "SELECT * FROM categories WHERE id = ? LIMIT 1",
      { replacements: [req.params.id], type: QueryTypes.SELECT }
    );

    if (!existing) return res.status(404).json({ message: "Category not found." });

    if (triggerSubcategoryId) {
      const [triggerSub] = await sequelize.query(
        "SELECT category_id FROM subcategories WHERE id = ? LIMIT 1",
        { replacements: [triggerSubcategoryId], type: QueryTypes.SELECT }
      );

      if (triggerSub && triggerSub.category_id === parseInt(req.params.id)) {
        return res.status(400).json({ message: "Trigger subcategory can't belong to the category it triggers." });
      }
    }

    const updatedViews = existing.views + (views ?? 0);

    await sequelize.query(
      "UPDATE categories SET title = ?, views = ?, order_index = ?, trigger_subcategory_id = ?, updated_at = NOW() WHERE id = ?",
      {
        replacements: [title, updatedViews, order ?? null, triggerSubcategoryId || null, req.params.id],
        type: QueryTypes.UPDATE,
      }
    );

    res.json({ message: "Category updated successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update category." });
  }
});

router.delete("/:id", requireAdmin, async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const [existing] = await sequelize.query(
      "SELECT * FROM categories WHERE id = ? LIMIT 1",
      { replacements: [req.params.id], type: QueryTypes.SELECT, transaction: t }
    );

    if (!existing) {
      await t.rollback();
      return res.status(404).json({ message: "Category not found." });
    }

    const [{ affectedCount }] = await sequelize.query(
      "SELECT COUNT(*) as affectedCount FROM subcategories WHERE category_id = ?",
      { replacements: [req.params.id], type: QueryTypes.SELECT, transaction: t }
    );

    if (affectedCount > 0 && req.query.showConfirm) {
      await t.rollback();
      return res.status(409).json({
        message: `This will move ${affectedCount} subcategor${affectedCount === 1 ? "y" : "ies"} to Unassigned. Confirm to proceed.`,
        affectedCount,
      });
    }

    await sequelize.query(
      "UPDATE subcategories SET category_id = 1 WHERE category_id = ?",
      { replacements: [req.params.id], type: QueryTypes.UPDATE, transaction: t }
    );

    await sequelize.query("DELETE FROM photo_categories WHERE category_id = ?",
      { replacements: [req.params.id], type: QueryTypes.DELETE, transaction: t }
    );

    await sequelize.query("DELETE FROM categories WHERE id = ?",
      { replacements: [req.params.id], type: QueryTypes.DELETE, transaction: t }
    );

    await t.commit();
    res.json({ message: "Category deleted successfully." });
  } catch (error) {
    await t.rollback();
    console.error(error);
    res.status(500).json({ message: "Failed to delete category." });
  }
});

module.exports = router;