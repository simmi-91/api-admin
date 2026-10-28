import type { RowDataPacket } from "mysql2/promise";

const { default: app } = await import("../server.js");
const { default: dbPool } = await import("../src/database.js");
const { getAdminToken, getNonAdminToken } = await import("./testAuth.js");
const { default: request } = await import("supertest");

// Runs against the dev database without touching existing data: every row these
// tests create has a name/title starting with PREFIX or is in one of the test years,
// and only those rows are deleted.
const PREFIX = "__giftlogtest__";
const SUMMARY_YEAR = 2150; // only the summary tests create gifts in this year
const GIFT_YEAR = 2151;
const UNKNOWN_ID = 999999999;

let adminToken: string;
let nonAdminToken: string;

type HttpMethod = "get" | "post" | "patch" | "delete";

const api = (method: HttpMethod, url: string) =>
  request(app)[method](`/giftlog${url}`).set("Authorization", adminToken);

const name = (label: string) => `${PREFIX}${label}`;

async function cleanUp() {
  const like = `${PREFIX.replace(/_/g, "\\_")}%`;
  // giftlog_gift_person rows go with the gifts (ON DELETE CASCADE)
  await dbPool.query(
    "DELETE FROM giftlog_gift WHERE title LIKE ? OR description LIKE ? OR year IN (?, ?)",
    [like, like, SUMMARY_YEAR, GIFT_YEAR]
  );
  await dbPool.query("DELETE FROM giftlog_person WHERE name LIKE ?", [like]);
  await dbPool.query("DELETE FROM giftlog_occasion WHERE name LIKE ?", [like]);
}

async function createPerson(label: string, is_household = false) {
  const response = await api("post", "/persons").send({ name: name(label), is_household });
  expect(response.status).toBe(201);
  return response.body.id as number;
}

async function createOccasion(label: string) {
  const response = await api("post", "/occasions").send({ name: name(label) });
  expect(response.status).toBe(201);
  return response.body.id as number;
}

async function createGift(data: Record<string, unknown>) {
  const response = await api("post", "/gifts").send({
    giver_ids: [],
    recipient_ids: [],
    ...data,
  });
  expect(response.status).toBe(201);
  return response.body;
}

async function countLinks(giftId: number) {
  const [rows] = await dbPool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM giftlog_gift_person WHERE gift_id = ?",
    [giftId]
  );
  return rows[0].n as number;
}

describe("Giftlog API", () => {
  beforeAll(async () => {
    adminToken = await getAdminToken();
    nonAdminToken = getNonAdminToken();
  });

  beforeEach(async () => {
    await cleanUp();
  });

  afterAll(async () => {
    await cleanUp();
    await dbPool.end();
  });

  // --- Security Tests ---

  const routes: { method: HttpMethod; url: string }[] = [
    { method: "get", url: "/years" },
    { method: "get", url: "/summary" },
    { method: "get", url: "/gifts" },
    { method: "get", url: "/gifts/1" },
    { method: "post", url: "/gifts" },
    { method: "patch", url: "/gifts/1" },
    { method: "delete", url: "/gifts/1" },
    { method: "post", url: "/gifts/mark-given" },
    { method: "get", url: "/persons" },
    { method: "post", url: "/persons" },
    { method: "patch", url: "/persons/1" },
    { method: "delete", url: "/persons/1" },
    { method: "get", url: "/occasions" },
    { method: "post", url: "/occasions" },
    { method: "patch", url: "/occasions/1" },
    { method: "delete", url: "/occasions/1" },
  ];

  routes.forEach(({ method, url }) => {
    it(`[SECURITY] ${method.toUpperCase()} ${url} should return 401 if no token is provided`, async () => {
      const response = await request(app)[method](`/giftlog${url}`);
      expect(response.status).toBe(401);
      expect(response.body.error).toBe("Access token missing.");
    });

    it(`[SECURITY] ${method.toUpperCase()} ${url} should return 403 for a non-admin user`, async () => {
      const response = await request(app)[method](`/giftlog${url}`).set("Authorization", nonAdminToken);
      expect(response.status).toBe(403);
      expect(response.body.error).toContain("not authorized");
    });
  });

  it.each<[HttpMethod, string]>([
    ["get", "/gifts/abc"],
    ["get", "/gifts/1.5"],
    ["delete", "/persons/0"],
    ["delete", "/occasions/-1"],
  ])("should return 400 for invalid id in %s %s", async (method, url) => {
    const response = await api(method, url);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid id" });
  });

  // --- Occasions ---

  describe("Occasions", () => {
    it("POST should create an occasion and return it", async () => {
      const response = await api("post", "/occasions").send({ name: name("jul") });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ id: expect.any(Number), name: name("jul") });
    });

    it("POST should return 400 if name is missing", async () => {
      const response = await api("post", "/occasions").send({});
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Name is required" });
    });

    it("POST should return 409 for a duplicate name", async () => {
      await createOccasion("jul");
      const response = await api("post", "/occasions").send({ name: name("jul") });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: "Name already exists" });
    });

    it("GET should list occasions", async () => {
      const id = await createOccasion("jul");
      const response = await api("get", "/occasions");

      expect(response.status).toBe(200);
      expect(response.body).toContainEqual({ id, name: name("jul") });
    });

    it("PATCH should rename an occasion", async () => {
      const id = await createOccasion("jul");
      const response = await api("patch", `/occasions/${id}`).send({ name: name("christmas") });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: "Occasion updated" });
      const list = await api("get", "/occasions");
      expect(list.body).toContainEqual({ id, name: name("christmas") });
    });

    it("PATCH should return 400 if name is missing or empty", async () => {
      const id = await createOccasion("jul");

      const missing = await api("patch", `/occasions/${id}`).send({});
      const empty = await api("patch", `/occasions/${id}`).send({ name: "" });

      expect(missing.status).toBe(400);
      expect(missing.body).toEqual({ error: "Missing fields: name" });
      expect(empty.status).toBe(400);
      expect(empty.body).toEqual({ error: "Name is required" });
    });

    it("PATCH should return 409 when renaming to an existing name", async () => {
      await createOccasion("jul");
      const id = await createOccasion("bursdag");
      const response = await api("patch", `/occasions/${id}`).send({ name: name("jul") });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: "Name already exists" });
    });

    it("PATCH should return 404 for an unknown id", async () => {
      const response = await api("patch", `/occasions/${UNKNOWN_ID}`).send({ name: name("x") });
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Occasion not found" });
    });

    it("DELETE should delete an occasion and return it", async () => {
      const id = await createOccasion("jul");

      const response = await api("delete", `/occasions/${id}`);
      const again = await api("delete", `/occasions/${id}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ id, name: name("jul") });
      expect(again.status).toBe(404);
      expect(again.body).toEqual({ error: "Occasion not found" });
    });

    it("DELETE should return 409 if the occasion is used by a gift", async () => {
      const id = await createOccasion("jul");
      await createGift({ title: name("gift"), year: GIFT_YEAR, occasion_id: id });

      const response = await api("delete", `/occasions/${id}`);

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: "In use by one or more gifts" });
    });
  });

  // --- Persons ---

  describe("Persons", () => {
    it("POST should create a person and return it", async () => {
      const response = await api("post", "/persons").send({ name: name("kari"), is_household: true });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ id: expect.any(Number), name: name("kari"), is_household: true });
    });

    it("POST should return 400 if name is missing", async () => {
      const response = await api("post", "/persons").send({ is_household: true });
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Name is required" });
    });

    it("POST should return 409 for a duplicate name", async () => {
      await createPerson("kari");
      const response = await api("post", "/persons").send({ name: name("kari") });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: "Name already exists" });
    });

    it("GET should list persons with is_household", async () => {
      const id = await createPerson("kari", true);
      const response = await api("get", "/persons");

      expect(response.status).toBe(200);
      expect(response.body).toContainEqual({ id, name: name("kari"), is_household: 1, gift_count: 0 });
    });

    it("GET should count each gift a person is linked to once", async () => {
      const occasionId = await createOccasion("jul");
      const id = await createPerson("kari");
      await createGift({ title: name("gift1"), year: GIFT_YEAR, occasion_id: occasionId, giver_ids: [id] });
      await createGift({
        title: name("gift2"),
        year: GIFT_YEAR,
        occasion_id: occasionId,
        giver_ids: [id],
        recipient_ids: [id],
      });

      const response = await api("get", "/persons");

      expect(response.body).toContainEqual({ id, name: name("kari"), is_household: 0, gift_count: 2 });
    });

    it("PATCH should update name and is_household", async () => {
      const id = await createPerson("kari");
      const response = await api("patch", `/persons/${id}`).send({ name: name("kari2"), is_household: true });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: "Person updated" });
      const list = await api("get", "/persons");
      expect(list.body).toContainEqual({ id, name: name("kari2"), is_household: 1, gift_count: 0 });
    });

    it("PATCH should return 400 listing missing fields", async () => {
      const id = await createPerson("kari");
      const response = await api("patch", `/persons/${id}`).send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Missing fields: name, is_household" });
    });

    it("PATCH should return 400 if is_household is null", async () => {
      const id = await createPerson("kari");
      const response = await api("patch", `/persons/${id}`).send({ name: name("kari"), is_household: null });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "Missing required fields" });
    });

    it("PATCH should return 409 when renaming to an existing name", async () => {
      await createPerson("kari");
      const id = await createPerson("ola");
      const response = await api("patch", `/persons/${id}`).send({ name: name("kari"), is_household: false });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: "Name already exists" });
    });

    it("PATCH should return 404 for an unknown id", async () => {
      const response = await api("patch", `/persons/${UNKNOWN_ID}`).send({ name: name("x"), is_household: false });
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Person not found" });
    });

    it("DELETE should delete a person and return it", async () => {
      const id = await createPerson("kari", true);

      const response = await api("delete", `/persons/${id}`);
      const again = await api("delete", `/persons/${id}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ id, name: name("kari"), is_household: 1 });
      expect(again.status).toBe(404);
      expect(again.body).toEqual({ error: "Person not found" });
    });

    it("DELETE should return 409 if the person is linked to a gift", async () => {
      const occasionId = await createOccasion("jul");
      const id = await createPerson("kari");
      await createGift({ title: name("gift"), year: GIFT_YEAR, occasion_id: occasionId, giver_ids: [id] });

      const response = await api("delete", `/persons/${id}`);

      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: "In use by one or more gifts" });
    });
  });

  // --- Gifts ---

  describe("Gifts", () => {
    let occasionId: number;
    let kari: number;
    let ola: number;
    let per: number;

    beforeEach(async () => {
      occasionId = await createOccasion("jul");
      kari = await createPerson("kari", true);
      ola = await createPerson("ola", true);
      per = await createPerson("per");
    });

    const fullGift = (overrides: Record<string, unknown> = {}) => ({
      title: name("gift"),
      description: null,
      year: GIFT_YEAR,
      date_given: null,
      occasion_id: occasionId,
      status: "given",
      price: null,
      giver_ids: [],
      recipient_ids: [],
      ...overrides,
    });

    describe("POST /gifts", () => {
      it("should create a gift with persons and return it", async () => {
        const response = await api("post", "/gifts").send({
          title: name("gift"),
          description: "A book",
          year: GIFT_YEAR,
          date_given: `${GIFT_YEAR}-12-24`,
          occasion_id: occasionId,
          price: 300,
          giver_ids: [kari, ola],
          recipient_ids: [per],
        });

        expect(response.status).toBe(201);
        expect(response.body).toMatchObject({
          id: expect.any(Number),
          title: name("gift"),
          description: "A book",
          year: GIFT_YEAR,
          date_given: `${GIFT_YEAR}-12-24`,
          occasion_id: occasionId,
          status: "given",
          price: 300,
          recipients: [{ id: per, name: name("per") }],
        });
        expect(response.body.givers).toHaveLength(2);
        expect(response.body.givers).toEqual(
          expect.arrayContaining([
            { id: kari, name: name("kari") },
            { id: ola, name: name("ola") },
          ])
        );
      });

      it("should default status to 'given' and price to null", async () => {
        const gift = await createGift({ title: name("gift"), year: GIFT_YEAR, occasion_id: occasionId });

        expect(gift.status).toBe("given");
        expect(gift.price).toBeNull();
      });

      it("should store a person only once if the id is repeated", async () => {
        const gift = await createGift({
          title: name("gift"),
          year: GIFT_YEAR,
          occasion_id: occasionId,
          recipient_ids: [per, per],
        });

        expect(gift.recipients).toEqual([{ id: per, name: name("per") }]);
      });

      it("should allow an idea without year and occasion", async () => {
        const gift = await createGift({ title: name("idea"), status: "idea" });

        expect(gift).toMatchObject({ status: "idea", year: null, occasion_id: null });
      });

      it("should return 400 if title and description are missing", async () => {
        const response = await api("post", "/gifts").send({ giver_ids: [], recipient_ids: [] });
        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: "Title or description is required" });
      });

      it("should return 400 if giver_ids or recipient_ids are not lists", async () => {
        const response = await api("post", "/gifts").send({
          title: name("gift"),
          year: GIFT_YEAR,
          occasion_id: occasionId,
          giver_ids: [kari],
        });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: "giver_ids and recipient_ids must be lists" });
      });

      it("should return 400 if a non-idea gift has no year or occasion", async () => {
        const response = await api("post", "/gifts").send({ title: name("gift"), giver_ids: [], recipient_ids: [] });
        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: "Gift is missing required fields" });
      });

      it("should return 400 for an unknown occasion", async () => {
        const response = await api("post", "/gifts").send({
          title: name("gift"),
          year: GIFT_YEAR,
          occasion_id: UNKNOWN_ID,
          giver_ids: [],
          recipient_ids: [],
        });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: "Unknown person or occasion" });
      });

      it("should roll back the gift if a person does not exist", async () => {
        const response = await api("post", "/gifts").send({
          title: name("rollback"),
          year: GIFT_YEAR,
          occasion_id: occasionId,
          giver_ids: [kari, UNKNOWN_ID],
          recipient_ids: [],
        });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: "Unknown person or occasion" });
        const [rows] = await dbPool.query<RowDataPacket[]>("SELECT id FROM giftlog_gift WHERE title = ?", [
          name("rollback"),
        ]);
        expect(rows).toHaveLength(0);
      });
    });

    describe("GET /gifts/:id", () => {
      it("should return the gift with givers and recipients", async () => {
        const created = await createGift({
          title: name("gift"),
          year: GIFT_YEAR,
          occasion_id: occasionId,
          giver_ids: [kari],
          recipient_ids: [per],
        });

        const response = await api("get", `/gifts/${created.id}`);

        expect(response.status).toBe(200);
        expect(response.body).toEqual(created);
      });

      it("should return 404 for an unknown id", async () => {
        const response = await api("get", `/gifts/${UNKNOWN_ID}`);
        expect(response.status).toBe(404);
        expect(response.body).toEqual({ error: "Gift not found" });
      });
    });

    describe("GET /gifts", () => {
      const ids = (response: { body: { id: number }[] }) => response.body.map((gift) => gift.id).sort();

      it("should leave out ideas unless status is given", async () => {
        const given = await createGift({ title: name("given"), year: GIFT_YEAR, occasion_id: occasionId });
        const idea = await createGift({ title: name("idea"), status: "idea", year: GIFT_YEAR });

        const all = await api("get", `/gifts?year=${GIFT_YEAR}`);
        const ideas = await api("get", `/gifts?year=${GIFT_YEAR}&status=idea`);

        expect(all.status).toBe(200);
        expect(ids(all)).toEqual([given.id]);
        expect(ids(ideas)).toEqual([idea.id]);
      });

      it("should filter by occasion, text and person role", async () => {
        const otherOccasion = await createOccasion("bursdag");
        const book = await createGift({
          title: name("book"),
          year: GIFT_YEAR,
          occasion_id: occasionId,
          giver_ids: [kari],
          recipient_ids: [per],
        });
        const scarf = await createGift({
          title: name("scarf"),
          year: GIFT_YEAR,
          occasion_id: otherOccasion,
          giver_ids: [per],
          recipient_ids: [kari],
        });

        const byOccasion = await api("get", `/gifts?year=${GIFT_YEAR}&occasion_id=${otherOccasion}`);
        const byText = await api("get", `/gifts?year=${GIFT_YEAR}&q=${name("book")}`);
        const kariGave = await api("get", `/gifts?year=${GIFT_YEAR}&person_id=${kari}&role=giver`);
        const kariAny = await api("get", `/gifts?year=${GIFT_YEAR}&person_id=${kari}`);

        expect(ids(byOccasion)).toEqual([scarf.id]);
        expect(ids(byText)).toEqual([book.id]);
        expect(ids(kariGave)).toEqual([book.id]);
        expect(ids(kariAny)).toEqual([book.id, scarf.id].sort());
      });
    });

    describe("PATCH /gifts/:id", () => {
      it("should update all fields and replace persons", async () => {
        const created = await createGift({
          title: name("gift"),
          year: GIFT_YEAR,
          occasion_id: occasionId,
          giver_ids: [kari],
          recipient_ids: [per],
        });

        const response = await api("patch", `/gifts/${created.id}`).send(
          fullGift({
            title: name("updated"),
            description: "Changed",
            date_given: `${GIFT_YEAR}-05-01`,
            status: "sent",
            price: 150,
            giver_ids: [ola],
            recipient_ids: [kari, per],
          })
        );

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ message: "Gift updated" });
        const gift = (await api("get", `/gifts/${created.id}`)).body;
        expect(gift).toMatchObject({
          title: name("updated"),
          description: "Changed",
          date_given: `${GIFT_YEAR}-05-01`,
          status: "sent",
          price: 150,
          givers: [{ id: ola, name: name("ola") }],
        });
        expect(gift.recipients).toHaveLength(2);
      });

      it("should return 400 listing missing fields", async () => {
        const created = await createGift({ title: name("gift"), year: GIFT_YEAR, occasion_id: occasionId });
        const response = await api("patch", `/gifts/${created.id}`).send({ title: name("gift") });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({
          error: "Missing fields: description, year, date_given, occasion_id, status, price, giver_ids, recipient_ids",
        });
      });

      it("should return 400 if title and description are both null", async () => {
        const created = await createGift({ title: name("gift"), year: GIFT_YEAR, occasion_id: occasionId });
        const response = await api("patch", `/gifts/${created.id}`).send(fullGift({ title: null }));

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: "Title or description is required" });
      });

      it("should return 400 if giver_ids or recipient_ids are not lists", async () => {
        const created = await createGift({ title: name("gift"), year: GIFT_YEAR, occasion_id: occasionId });
        const response = await api("patch", `/gifts/${created.id}`).send(fullGift({ giver_ids: null }));

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: "giver_ids and recipient_ids must be lists" });
      });

      it("should return 400 if status is null", async () => {
        const created = await createGift({ title: name("gift"), year: GIFT_YEAR, occasion_id: occasionId });
        const response = await api("patch", `/gifts/${created.id}`).send(fullGift({ status: null }));

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: "Missing required fields" });
      });

      it("should roll back if a person does not exist", async () => {
        const created = await createGift({
          title: name("gift"),
          year: GIFT_YEAR,
          occasion_id: occasionId,
          giver_ids: [kari],
        });

        const response = await api("patch", `/gifts/${created.id}`).send(
          fullGift({ title: name("changed"), giver_ids: [UNKNOWN_ID] })
        );

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: "Unknown person or occasion" });
        const gift = (await api("get", `/gifts/${created.id}`)).body;
        expect(gift.title).toBe(name("gift"));
        expect(gift.givers).toEqual([{ id: kari, name: name("kari") }]);
      });

      it("should return 404 for an unknown id", async () => {
        const response = await api("patch", `/gifts/${UNKNOWN_ID}`).send(fullGift());
        expect(response.status).toBe(404);
        expect(response.body).toEqual({ error: "Gift not found" });
      });
    });

    describe("DELETE /gifts/:id", () => {
      it("should delete the gift and its person links and return it", async () => {
        const created = await createGift({
          title: name("gift"),
          year: GIFT_YEAR,
          occasion_id: occasionId,
          giver_ids: [kari],
          recipient_ids: [per],
        });

        const response = await api("delete", `/gifts/${created.id}`);

        expect(response.status).toBe(200);
        expect(response.body).toEqual(created);
        expect(await countLinks(created.id)).toBe(0);
        expect((await api("get", `/gifts/${created.id}`)).status).toBe(404);
      });

      it("should return 404 for an unknown id", async () => {
        const response = await api("delete", `/gifts/${UNKNOWN_ID}`);
        expect(response.status).toBe(404);
        expect(response.body).toEqual({ error: "Gift not found" });
      });
    });

    describe("POST /gifts/mark-given", () => {
      it("should set status 'given' and today's date by default", async () => {
        const created = await createGift({
          title: name("gift"),
          status: "bought",
          year: GIFT_YEAR,
          occasion_id: occasionId,
        });
        const [[{ today }]] = await dbPool.query<RowDataPacket[]>(
          "SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today"
        );

        const response = await api("post", "/gifts/mark-given").send({ id: created.id });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ message: "Gift marked as given" });
        const gift = (await api("get", `/gifts/${created.id}`)).body;
        expect(gift).toMatchObject({ status: "given", date_given: today, year: Number(today.slice(0, 4)) });
      });

      it("should set year from date_given when the gift has no year", async () => {
        const created = await createGift({ title: name("idea"), status: "idea", occasion_id: occasionId });

        await api("post", "/gifts/mark-given").send({ id: created.id, date_given: `${GIFT_YEAR}-12-24` });

        const gift = (await api("get", `/gifts/${created.id}`)).body;
        expect(gift).toMatchObject({ status: "given", date_given: `${GIFT_YEAR}-12-24`, year: GIFT_YEAR });
      });

      it("should replace an existing year with the year it was given", async () => {
        const created = await createGift({
          title: name("gift"),
          status: "sent",
          year: GIFT_YEAR,
          occasion_id: occasionId,
        });
        // Removed by title, not by year
        const givenDate = `${GIFT_YEAR + 1}-01-02`;

        await api("post", "/gifts/mark-given").send({ id: created.id, date_given: givenDate });

        const gift = (await api("get", `/gifts/${created.id}`)).body;
        expect(gift).toMatchObject({ date_given: givenDate, year: GIFT_YEAR + 1 });
      });

      it("should return 400 if the gift has no occasion", async () => {
        const created = await createGift({ title: name("idea"), status: "idea" });
        const response = await api("post", "/gifts/mark-given").send({ id: created.id });

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: "Gift is missing required fields" });
      });

      it.each([{}, { id: "abc" }, { id: 0 }, { id: 1.5 }])("should return 400 for invalid id %j", async (body) => {
        const response = await api("post", "/gifts/mark-given").send(body);
        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: "A valid id is required" });
      });

      it("should return 404 for an unknown id", async () => {
        const response = await api("post", "/gifts/mark-given").send({ id: UNKNOWN_ID });
        expect(response.status).toBe(404);
        expect(response.body).toEqual({ error: "Gift not found" });
      });
    });
  });

  // --- Years ---

  describe("GET /years", () => {
    it("should return unique years in descending order, including the current year", async () => {
      const occasionId = await createOccasion("jul");
      await createGift({ title: name("a"), year: GIFT_YEAR, occasion_id: occasionId });
      await createGift({ title: name("b"), year: GIFT_YEAR, occasion_id: occasionId });

      const response = await api("get", "/years");
      const years: number[] = response.body;

      expect(response.status).toBe(200);
      expect(years).toContain(GIFT_YEAR);
      expect(years).toContain(new Date().getFullYear());
      expect(new Set(years).size).toBe(years.length);
      expect(years).toEqual([...years].sort((a, b) => b - a));
    });
  });

  // --- Summary ---

  describe("GET /summary", () => {
    const totals = (givenCount: number, givenTotal: number, receivedCount: number, receivedTotal: number) => ({
      given: { count: givenCount, total: givenTotal },
      received: { count: receivedCount, total: receivedTotal },
    });

    it("should split gifts into given and received per year, occasion and household person", async () => {
      const jul = await createOccasion("jul");
      const bursdag = await createOccasion("bursdag");
      const kari = await createPerson("kari", true);
      const ola = await createPerson("ola", true);
      const per = await createPerson("per");
      const gift = (label: string, data: Record<string, unknown>) =>
        createGift({ title: name(label), year: SUMMARY_YEAR, ...data });

      await gift("kari-to-per", { occasion_id: jul, price: 100, giver_ids: [kari], recipient_ids: [per] });
      await gift("both-to-per", { occasion_id: jul, price: 200, giver_ids: [kari, ola], recipient_ids: [per] });
      await gift("per-to-ola", { occasion_id: bursdag, price: 50, giver_ids: [per], recipient_ids: [ola] });
      await gift("per-to-both", { occasion_id: jul, giver_ids: [per], recipient_ids: [kari, ola] });
      await gift("kari-to-ola", { occasion_id: bursdag, price: 30, giver_ids: [kari], recipient_ids: [ola] });
      // Left out: no household person, and an idea
      await gift("per-to-per", { occasion_id: jul, price: 999, giver_ids: [per], recipient_ids: [per] });
      await gift("idea", { occasion_id: jul, status: "idea", price: 500, giver_ids: [kari], recipient_ids: [per] });

      const response = await api("get", "/summary");

      expect(response.status).toBe(200);
      const year = response.body.years.find((y: { year: number }) => y.year === SUMMARY_YEAR);
      expect(year).toEqual({
        year: SUMMARY_YEAR,
        ...totals(3, 330, 3, 80),
        occasions: [
          { id: bursdag, name: name("bursdag"), ...totals(1, 30, 2, 80) },
          { id: jul, name: name("jul"), ...totals(2, 300, 1, 0) },
        ],
        persons: [
          { id: kari, name: name("kari"), ...totals(2, 130, 0, 0) },
          { id: ola, name: name("ola"), ...totals(0, 0, 2, 80) },
          { id: null, name: "Felles", ...totals(1, 200, 1, 0) },
        ],
      });
    });

    it("should sort years descending and include byStatus", async () => {
      const response = await api("get", "/summary");
      const years: number[] = response.body.years.map((y: { year: number }) => y.year);

      expect(response.status).toBe(200);
      expect(years).toEqual([...years].sort((a, b) => b - a));
      expect(Array.isArray(response.body.byStatus)).toBe(true);
      response.body.byStatus.forEach((row: unknown) => {
        expect(row).toEqual({
          status: expect.stringMatching(/^(idea|bought|sent|given)$/),
          count: expect.any(Number),
          total: expect.any(Number),
        });
      });
    });
  });
});
