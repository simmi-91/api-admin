import express from "express";
import dbPool from "../database.js";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { requireAuth, verifyAdmin } from "../middleware/authMiddleware.js";
import { errorHandler } from "../middleware/errorHandler.js";

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

interface SummaryGiftRow extends RowDataPacket {
    id: number;
    year: number;
    price: number | null;
    occasion_id: number;
    occasion_name: string;
}

interface StatusSummaryRow extends RowDataPacket {
    status: GiftStatus;
    count: number;
    total: number;
}

type Direction = "given" | "received";

interface Totals {
    count: number;
    total: number;
}

type DirectionTotals = Record<Direction, Totals>;

interface OccasionSummary extends DirectionTotals {
    id: number;
    name: string;
}

// id is null for "Felles" (more than one household person on the same side)
interface PersonSummary extends DirectionTotals {
    id: number | null;
    name: string;
}

interface YearSummary extends DirectionTotals {
    year: number;
    occasions: Map<number, OccasionSummary>;
    persons: Map<number | null, PersonSummary>;
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
    occasion_id, status, price, created_at, updated_at
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

async function getGift(id: number) {
    const [rows] = await dbPool.query<GiftRow[]>(`SELECT ${GIFT_COLUMNS} FROM giftlog_gift WHERE id = ?`, [id]);
    const [gift] = await attachPersons(rows);
    return gift;
}

// Runs `work` in a transaction; rolls back and rethrows if it fails
async function inTransaction<T>(work: (conn: PoolConnection) => Promise<T>) {
    const conn = await dbPool.getConnection();
    try {
        await conn.beginTransaction();
        const result = await work(conn);
        await conn.commit();
        return result;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

// Replaces all givers and recipients of a gift
async function setGiftPersons(conn: PoolConnection, giftId: number, giverIds: number[], recipientIds: number[]) {
    await conn.query(`DELETE FROM giftlog_gift_person WHERE gift_id = ?`, [giftId]);
    const links = [
        ...[...new Set(giverIds)].map((personId) => [giftId, personId, "giver"]),
        ...[...new Set(recipientIds)].map((personId) => [giftId, personId, "recipient"]),
    ];
    if (links.length > 0) {
        await conn.query(`INSERT INTO giftlog_gift_person (gift_id, person_id, role) VALUES ?`, [links]);
    }
}

// Fields that are not in the body at all (null counts as sent)
const missingFields = (body: Record<string, unknown> | undefined, fields: string[]) =>
    fields.filter((field) => body?.[field] === undefined);

const GIFT_FIELDS = [
    "title",
    "description",
    "year",
    "date_given",
    "occasion_id",
    "status",
    "price",
    "giver_ids",
    "recipient_ids",
];

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

const emptyDirectionTotals = (): DirectionTotals => ({
    given: { count: 0, total: 0 },
    received: { count: 0, total: 0 },
});

const ROLE_DIRECTIONS: [GiftRole, Direction][] = [
    ["giver", "given"],
    ["recipient", "received"],
];

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "nb");

// Given = a household person is giver, received = a household person is recipient.
// A gift inside the household counts as both; gifts without a household person are left out.
router.get("/summary", async (req, res) => {
    // Ideas are left out; non-ideas always have year and occasion (chk_giftlog_gift_idea)
    const [gifts] = await dbPool.query<SummaryGiftRow[]>(
        `SELECT g.id, g.year, g.price, o.id AS occasion_id, o.name AS occasion_name
         FROM giftlog_gift g
         JOIN giftlog_occasion o ON o.id = g.occasion_id
         WHERE g.status <> 'idea'`
    );
    const [householdLinks] = await dbPool.query<GiftPersonLinkRow[]>(
        `SELECT gp.gift_id, gp.role, p.id, p.name
         FROM giftlog_gift_person gp
         JOIN giftlog_person p ON p.id = gp.person_id
         WHERE p.is_household = 1`
    );
    const [byStatus] = await dbPool.query<StatusSummaryRow[]>(
        `SELECT status, COUNT(*) AS count, CAST(COALESCE(SUM(price), 0) AS SIGNED) AS total
         FROM giftlog_gift
         GROUP BY status
         ORDER BY status`
    );

    const linksByGift = new Map<number, GiftPersonLinkRow[]>();
    householdLinks.forEach((link) => {
        linksByGift.set(link.gift_id, [...(linksByGift.get(link.gift_id) ?? []), link]);
    });

    const years = new Map<number, YearSummary>();
    gifts.forEach((gift) => {
        const links = linksByGift.get(gift.id) ?? [];

        ROLE_DIRECTIONS.forEach(([role, direction]) => {
            const persons = links.filter((link) => link.role === role);
            if (persons.length === 0) {
                return;
            }
            const person =
                persons.length === 1
                    ? { id: persons[0].id, name: persons[0].name }
                    : { id: null, name: "Felles" };

            let year = years.get(gift.year);
            if (!year) {
                year = { year: gift.year, ...emptyDirectionTotals(), occasions: new Map(), persons: new Map() };
                years.set(gift.year, year);
            }
            let occasion = year.occasions.get(gift.occasion_id);
            if (!occasion) {
                occasion = { id: gift.occasion_id, name: gift.occasion_name, ...emptyDirectionTotals() };
                year.occasions.set(gift.occasion_id, occasion);
            }
            let personSummary = year.persons.get(person.id);
            if (!personSummary) {
                personSummary = { ...person, ...emptyDirectionTotals() };
                year.persons.set(person.id, personSummary);
            }

            [year, occasion, personSummary].forEach((summary) => {
                summary[direction].count += 1;
                summary[direction].total += gift.price ?? 0;
            });
        });
    });

    res.json({
        years: [...years.values()]
            .sort((a, b) => b.year - a.year)
            .map(({ occasions, persons, ...year }) => ({
                ...year,
                occasions: [...occasions.values()].sort(byName),
                // "Felles" last
                persons: [...persons.values()].sort(
                    (a, b) => Number(a.id === null) - Number(b.id === null) || byName(a, b)
                ),
            })),
        byStatus: byStatus.map(({ status, count, total }) => ({ status, count, total })),
    });
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
    const gift = await getGift(req.id!);
    if (!gift) {
        return res.status(404).json({ error: "Gift not found" });
    }
    res.json(gift);
});

router.post("/gifts", async (req, res) => {
    const { title, description, year, date_given, occasion_id, status, price, giver_ids, recipient_ids } =
        req.body ?? {};

    if (!title && !description) {
        return res.status(400).json({ error: "Title or description is required" });
    }
    if (!Array.isArray(giver_ids) || !Array.isArray(recipient_ids)) {
        return res.status(400).json({ error: "giver_ids and recipient_ids must be lists" });
    }

    const giftId = await inTransaction(async (conn) => {
        const sql = `INSERT INTO giftlog_gift (title, description, year, date_given, occasion_id, status, price) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        const [result] = await conn.query<ResultSetHeader>(sql, [
            title,
            description,
            year,
            date_given,
            occasion_id,
            status ?? "given",
            price ?? null,
        ]);
        await setGiftPersons(conn, result.insertId, giver_ids, recipient_ids);
        return result.insertId;
    });

    res.status(201).json(await getGift(giftId));
});

router.post("/gifts/mark-given", async (req, res) => {
    const { id, date_given } = req.body ?? {};

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "A valid id is required" });
    }

    // Year always follows the date it was given. MySQL applies SET left to right,
    // so year uses the new date_given
    const [result] = await dbPool.query<ResultSetHeader>(
        `UPDATE giftlog_gift
         SET status = 'given', date_given = COALESCE(?, CURDATE()), year = YEAR(date_given)
         WHERE id = ?`,
        [date_given ?? null, id]
    );
    if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Gift not found" });
    }

    res.json({ message: "Gift marked as given" });
});

router.patch("/gifts/:id", async (req, res) => {
    const missing = missingFields(req.body, GIFT_FIELDS);
    if (missing.length > 0) {
        return res.status(400).json({ error: `Missing fields: ${missing.join(", ")}` });
    }

    const { title, description, year, date_given, occasion_id, status, price, giver_ids, recipient_ids } = req.body;

    if (!title && !description) {
        return res.status(400).json({ error: "Title or description is required" });
    }
    if (!Array.isArray(giver_ids) || !Array.isArray(recipient_ids)) {
        return res.status(400).json({ error: "giver_ids and recipient_ids must be lists" });
    }

    const found = await inTransaction(async (conn) => {
        const [result] = await conn.query<ResultSetHeader>(
            `UPDATE giftlog_gift
             SET title = ?, description = ?, year = ?, date_given = ?, occasion_id = ?, status = ?, price = ?
             WHERE id = ?`,
            [title, description, year, date_given, occasion_id, status, price, req.id]
        );
        if (result.affectedRows === 0) {
            return false;
        }
        await setGiftPersons(conn, req.id!, giver_ids, recipient_ids);
        return true;
    });
    if (!found) {
        return res.status(404).json({ error: "Gift not found" });
    }

    res.json({ message: "Gift updated" });
});

router.delete("/gifts/:id", async (req, res) => {
    const gift = await getGift(req.id!);
    if (!gift) {
        return res.status(404).json({ error: "Gift not found" });
    }

    // giftlog_gift_person rows are removed by ON DELETE CASCADE
    await dbPool.query(`DELETE FROM giftlog_gift WHERE id = ?`, [req.id]);

    res.json(gift);
});

// Persons
router.get("/persons", async (req, res) => {
    const [rows] = await dbPool.query<PersonRow[]>(`SELECT id, name, is_household FROM giftlog_person`, []);
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
        name, is_household,
    };

    res.status(201).json(newItem);
});

router.patch("/persons/:id", async (req, res) => {
    const missing = missingFields(req.body, ["name", "is_household"]);
    if (missing.length > 0) {
        return res.status(400).json({ error: `Missing fields: ${missing.join(", ")}` });
    }

    const { name, is_household } = req.body;

    if (!name) {
        return res.status(400).json({ error: "Name is required" });
    }

    const [result] = await dbPool.query<ResultSetHeader>(
        `UPDATE giftlog_person SET name = ?, is_household = ? WHERE id = ?`,
        [name, is_household, req.id]
    );
    if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Person not found" });
    }

    res.json({ message: "Person updated" });
});

router.delete("/persons/:id", async (req, res) => {
    const [rows] = await dbPool.query<PersonRow[]>(`SELECT id, name, is_household FROM giftlog_person WHERE id = ?`, [
        req.id,
    ]);
    if (rows.length === 0) {
        return res.status(404).json({ error: "Person not found" });
    }

    // Linked to a gift -> ER_ROW_IS_REFERENCED_2 (409)
    await dbPool.query(`DELETE FROM giftlog_person WHERE id = ?`, [req.id]);

    res.json(rows[0]);
});

// Occasions
router.get("/occasions", async (req, res) => {
    const [rows] = await dbPool.query<OccasionRow[]>(`SELECT id, name FROM giftlog_occasion`, []);
    res.json(rows);
});

router.post("/occasions", async (req, res) => {
    const { name } = req.body ?? {};

    if (!name) {
        return res.status(400).json({ error: "Name is required" });
    }

    const [result] = await dbPool.query<ResultSetHeader>(`INSERT INTO giftlog_occasion (name) VALUES (?)`, [name]);

    res.status(201).json({ id: result.insertId, name });
});

router.patch("/occasions/:id", async (req, res) => {
    const missing = missingFields(req.body, ["name"]);
    if (missing.length > 0) {
        return res.status(400).json({ error: `Missing fields: ${missing.join(", ")}` });
    }

    const { name } = req.body;

    if (!name) {
        return res.status(400).json({ error: "Name is required" });
    }

    const [result] = await dbPool.query<ResultSetHeader>(`UPDATE giftlog_occasion SET name = ? WHERE id = ?`, [
        name,
        req.id,
    ]);
    if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Occasion not found" });
    }

    res.json({ message: "Occasion updated" });
});

router.delete("/occasions/:id", async (req, res) => {
    const [rows] = await dbPool.query<OccasionRow[]>(`SELECT id, name FROM giftlog_occasion WHERE id = ?`, [req.id]);
    if (rows.length === 0) {
        return res.status(404).json({ error: "Occasion not found" });
    }

    // Used by a gift -> ER_ROW_IS_REFERENCED_2 (409)
    await dbPool.query(`DELETE FROM giftlog_occasion WHERE id = ?`, [req.id]);

    res.json(rows[0]);
});

// Error handler
router.use(
    errorHandler({
        ER_DUP_ENTRY: [409, "Name already exists"],
        ER_BAD_NULL_ERROR: [400, "Missing required fields"],
        ER_ROW_IS_REFERENCED_2: [409, "In use by one or more gifts"],
        ER_NO_REFERENCED_ROW_2: [400, "Unknown person or occasion"],
        ER_CHECK_CONSTRAINT_VIOLATED: [400, "Gift is missing required fields"],
    })
);

export default router;
