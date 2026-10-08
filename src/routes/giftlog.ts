import express from "express";
import dbPool from "../database.js";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { requireAuth, verifyAdmin } from "../middleware/authMiddleware.js";
import { errorHandler } from "../middleware/errorHandler.js";
import { HttpError } from "../utils/errors.js";

type GiftStatus = "idea" | "bought" | "sent" | "given";
type GiftRole = "giver" | "recipient";

interface GiftRow extends RowDataPacket {
    id: number;
    title: string | null;
    description: string | null;
    year: number | null;
    date_given: string | null;
    occasion_id: number | null;
    status: GiftStatus;
    price: number | null;
    from_idea_id: number | null;
    created_at: Date | null;
    updated_at: Date | null;
}

interface GiftPersonLinkRow extends RowDataPacket {
    gift_id: number;
    role: GiftRole;
    id: number;
    name: string;
}

interface PersonRow extends RowDataPacket {
    id: number;
    name: string;
    is_household: number;
}

interface OccasionRow extends RowDataPacket {
    id: number;
    name: string;
}

const router = express.Router();

router.use(requireAuth, verifyAdmin);
router.param("id", (req, res, next, value) => {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid id" });
    }
    req.id = id;
    next();
});

const GIFT_COLUMNS = `
    id, title, description, year,
    DATE_FORMAT(date_given, '%Y-%m-%d') AS date_given,
    occasion_id, status, price, from_idea_id, created_at, updated_at
`;

// Functions
async function attachPersons(gifts: GiftRow[]) {
    if (gifts.length === 0) {
        return [];
    }
    const [links] = await dbPool.query<GiftPersonLinkRow[]>(
        `SELECT gp.gift_id, gp.role, p.id, p.name
         FROM giftlog_gift_person gp
         JOIN giftlog_person p ON p.id = gp.person_id
         WHERE gp.gift_id IN (?)
         ORDER BY p.name`,
        [gifts.map((gift) => gift.id)]
    );
    const personsFor = (giftId: number, role: GiftRole) =>
        links
            .filter((link) => link.gift_id === giftId && link.role === role)
            .map(({ id, name }) => ({ id, name }));

    return gifts.map((gift) => ({
        ...gift,
        givers: personsFor(gift.id, "giver"),
        recipients: personsFor(gift.id, "recipient"),
    }));
}

// Year
router.get("/years", async (req, res) => {
    const [rows] = await dbPool.query<RowDataPacket[]>(
        `SELECT DISTINCT year FROM giftlog_gift
            WHERE year IS NOT NULL ORDER BY year DESC`
    );
    const years = new Set<number>(rows.map((row) => row.year));
    years.add(new Date().getFullYear());
    res.json([...years].sort((a, b) => b - a));
});

router.get("/summary", async (req, res) => {
    throw new HttpError(501, "Not implemented");
});

// Gift
router.get("/gifts", async (req, res) => {
    const { year, occasion_id, status, person_id, role, q } = req.query;
    const where: string[] = [];
    const params: unknown[] = [];

    if (status) {
        where.push("status = ?");
        params.push(status);
    } else {
        where.push("status <> 'idea'");
    }
    if (year) {
        where.push("year = ?");
        params.push(year);
    }
    if (occasion_id) {
        where.push("occasion_id = ?");
        params.push(occasion_id);
    }
    if (q) {
        where.push("(title LIKE ? OR description LIKE ?)");
        params.push(`%${q}%`, `%${q}%`);
    }
    if (person_id) {
        where.push(`EXISTS (
            SELECT 1 FROM giftlog_gift_person gp
            WHERE gp.gift_id = giftlog_gift.id
              AND gp.person_id = ?
              ${role ? "AND gp.role = ?" : ""}
        )`);
        params.push(person_id);
        if (role) {
            params.push(role);
        }
    }

    const [gifts] = await dbPool.query<GiftRow[]>(
        `SELECT ${GIFT_COLUMNS} FROM giftlog_gift
         WHERE ${where.join(" AND ")}
         ORDER BY year DESC, date_given DESC, id DESC`,
        params
    );
    res.json(await attachPersons(gifts));
});

router.get("/gifts/:id", async (req, res) => {
    const [rows] = await dbPool.query<GiftRow[]>(`SELECT ${GIFT_COLUMNS} FROM giftlog_gift WHERE id = ?`, [
        req.id,
    ]);
    if (rows.length === 0) {
        return res.status(404).json({ error: "Gift not found" });
    }
    const [gift] = await attachPersons(rows);
    res.json(gift);
});

router.post("/gifts", async (req, res) => {
    throw new HttpError(501, "Not implemented");
});

router.patch("/gifts/:id", async (req, res) => {
    throw new HttpError(501, "Not implemented");
});

router.delete("/gifts/:id", async (req, res) => {
    throw new HttpError(501, "Not implemented");
});

router.post("/gifts/mark-given", async (req, res) => {
    throw new HttpError(501, "Not implemented");
});

// Persons
router.get("/persons", async (req, res) => {
    const [rows] = await dbPool.query<PersonRow[]>(`SELECT id, name, is_household FROM giftlog_person`, []);
    if (rows.length === 0) {
        return res.status(404).json({ error: "Persons not found" });
    }
    res.json(rows);
});

router.post("/persons", async (req, res) => {
    const { name, is_household } = req.body;

    if (!name) {
        return res.status(400).json({ error: "Name is required" });
    }

    const sql = `INSERT INTO giftlog_person (name, is_household) VALUES (?, ?)`;
    const [result] = await dbPool.query<ResultSetHeader>(sql, [name, is_household || false]);

    const newId = result.insertId;

    const newItem = {
        id: newId,
        name: name,
        is_household: is_household,
    };

    res.status(201).json(newItem);
});

router.patch("/persons/:id", async (req, res) => {
    throw new HttpError(501, "Not implemented");
});

router.delete("/persons/:id", async (req, res) => {
    throw new HttpError(501, "Not implemented");
});

// Occasions
router.get("/occasions", async (req, res) => {
    const [rows] = await dbPool.query<OccasionRow[]>(`SELECT id, name FROM giftlog_occasion`, []);
    if (rows.length === 0) {
        return res.status(404).json({ error: "Occasions not found" });
    }
    res.json(rows);
});

router.post("/occasions", async (req, res) => {
    throw new HttpError(501, "Not implemented");
});

router.patch("/occasions/:id", async (req, res) => {
    throw new HttpError(501, "Not implemented");
});

router.delete("/occasions/:id", async (req, res) => {
    throw new HttpError(501, "Not implemented");
});

// Error handler
router.use(
    errorHandler({
        ER_ROW_IS_REFERENCED_2: [409, "In use by one or more gifts"],
        ER_NO_REFERENCED_ROW_2: [400, "Unknown person or occasion"],
        ER_CHECK_CONSTRAINT_VIOLATED: [400, "Gift is missing required fields"],
    })
);

export default router;
