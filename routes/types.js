const express = require("express");
const router = express.Router();
const { sequelize } = require("../config/database");
const { QueryTypes } = require("sequelize");
const { requireAdmin } = require("../middleware/requireAuth");

router.get("/", async (req, res) => {
  try {
    let query = `
      SELECT t.* 
      FROM photo_types t
      ORDER BY t.order_index ASC
    `;

    const types = await sequelize.query(query, {
      type: QueryTypes.SELECT,
    });

    res.json(types);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch photo types." });
  }
});

router.post("/", requireAdmin, async (req, res) => {
  try {
    const { title } = req.body;

    if (!title) {
      return res.status(400).json({ message: "Title is required." });
    }

    const [{ maxOrder }] = await sequelize.query(
      "SELECT COALESCE(MAX(order_index), -1) as maxOrder FROM photo_types",
      { type: QueryTypes.SELECT }
    );

    const [result] = await sequelize.query(
      "INSERT INTO photo_types (title, order_index, created_at, updated_at) VALUES (?, ?, NOW(), NOW())",
      {
        replacements: [title, maxOrder + 1],
        type: QueryTypes.INSERT,
      }
    );

    const photoTypeId = result;

    res.status(201).json({ message: "Photo type added successfully.", id: photoTypeId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to add photo type." });
  }
});

router.post("/bulk", requireAdmin, async (req, res) => {
  const { types } = req.body;

  if (!Array.isArray(types) || !types.length) {
    return res.status(400).json({ message: "An array of types is required." });
  }

  const t = await sequelize.transaction();

  try {
    const [{ maxOrder }] = await sequelize.query(
      "SELECT COALESCE(MAX(order_index), -1) as maxOrder FROM photo_types",
      { type: QueryTypes.SELECT, transaction: t }
    );

    const created = [];

    for (let i = 0; i < types.length; i++) {
      const title = types[i];
      const finalOrder = maxOrder + 1 + i;

      const [result] = await sequelize.query(
        `INSERT INTO photo_types (title, order_index, created_at, updated_at) VALUES (?, ?, NOW(), NOW())`,
        {
          replacements: [title, finalOrder],
          type: QueryTypes.INSERT,
          transaction: t,
        }
      );

      created.push({ id: result, title, order_index: finalOrder });
    }

    await t.commit();
    res.status(201).json({ message: "Types added successfully.", created });
  } catch (error) {
    await t.rollback();
    console.error(error);
    res.status(500).json({ message: "Failed to add types." });
  }
});

router.post("/reorder", requireAdmin, async(req, res) => {
  const { types } = req.body;

  if (!Array.isArray(types) || !types.length) {
    return res.status(400).json({ message: "List of types is required." });
  }

  const t = await sequelize.transaction();

  try {
    for (let i = 0; i < types.length; i++) {
      const { id, order_index } = types[i];

      await sequelize.query(
        "UPDATE photo_types SET order_index = ?, updated_at = NOW() WHERE id = ?",
        { replacements: [order_index, id], type: QueryTypes.UPDATE, transaction: t }
      );
    }

    await t.commit();
    res.status(200).json({ message: "Types successfully reordered." });
  } catch (error) {
    await t.rollback();
    console.error(error);
    res.status(500).json({ message: "Failed to order types." });
  }
})

router.put("/:id", requireAdmin, async (req, res) => {
  try {
    const { title, order } = req.body;

    const [existing] = await sequelize.query(
      "SELECT * FROM photo_types WHERE id = ? LIMIT 1",
      { replacements: [req.params.id], type: QueryTypes.SELECT }
    );

    if (!existing) return res.status(404).json({ message: "Photo type not found." });

    await sequelize.query(
      "UPDATE photo_types SET title = ?, order_index = ?, updated_at = NOW() WHERE id = ?",
      {
        replacements: [title, order ?? existing.order_index, req.params.id],
        type: QueryTypes.UPDATE,
      }
    );

    res.json({ message: "Photo type updated successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update photo type." });
  }
});

router.delete("/:id", requireAdmin, async (req, res) => {
  let isCommitted = false;
  const t = await sequelize.transaction();

  try {
    const [existing] = await sequelize.query(
      "SELECT * FROM photo_types WHERE id = ? LIMIT 1",
      { replacements: [req.params.id], type: QueryTypes.SELECT, transaction: t }
    );

    if (!existing) {
      await t.rollback();
      return res.status(404).json({ message: "Photo type not found." });
    }

    const [{ affectedCount }] = await sequelize.query(
      "SELECT COUNT(*) as affectedCount FROM photos WHERE photo_type_id = ?",
      { replacements: [req.params.id], type: QueryTypes.SELECT, transaction: t }
    );

    if (affectedCount > 0 && req.query.showConfirm) {
      await t.rollback();
      return res.status(409).json({
        message: `This will remove the type from ${affectedCount} photo${affectedCount === 1 ? "" : "s"}, moving them to Unassigned. Confirm to proceed.`,
        affectedCount,
      });
    }

    await sequelize.query(
      "UPDATE photos SET photo_type_id = NULL WHERE photo_type_id = ?",
      { replacements: [req.params.id], type: QueryTypes.UPDATE, transaction: t }
    );

    await sequelize.query("DELETE FROM photo_types WHERE id = ?",
      { replacements: [req.params.id], type: QueryTypes.DELETE, transaction: t }
    );

    const allRecords = await sequelize.query(
      "SELECT t.* FROM photo_types t ORDER BY t.order_index ASC",
      { type: QueryTypes.SELECT, transaction: t }
    );

    if (!allRecords) {
      await t.rollback();
      return res.status(404).json({ message: "Unable to update photo type ordering." });
    }

    let idx = 0;
    for (const record of allRecords) {
      await sequelize.query(
        "UPDATE photo_types SET order_index = ?, updated_at = NOW() WHERE id = ?",
        {
          replacements: [idx, record.id],
          type: QueryTypes.UPDATE,
          transaction: t
        }
      );

      idx++;
    }

    await t.commit();
    res.json({ message: "Photo type deleted successfully." });
  } catch (error) {
    await t.rollback();
    console.error(error);
    res.status(500).json({ message: "Failed to delete photo type." });
  }
});

module.exports = router;