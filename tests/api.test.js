/**
 * 德明宿舍點名系統 - API 完整測試
 *
 * 涵蓋範圍：Auth / Middleware / Students / Attendance / Security
 *
 * 注意：env 變數必須在 require('../server') 之前設定
 */

const request = require("supertest");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const fs = require("fs");
const path = require("path");

// ═══════════════════════════════════════════════════════════
// 測試設定（必須在 require server 之前）
// ═══════════════════════════════════════════════════════════
const TEST_DB = path.resolve(__dirname, "..", "test-dormitory.db");
const TEST_SESSIONS_DB = "test-sessions.db"; // 相對路徑，connect-sqlite3 用 dir: "./"

const ADMIN_USER = "xm2801";
const ADMIN_PASS = "testadmin123";
const YUCHENG_USER = "12130340";
const YUCHENG_PASS = "testyucheng123";
const DEMING_USER = "deming";
const DEMING_PASS = "testdeming123";

process.env.TEST_DB = TEST_DB;
process.env.SESSION_DB_NAME = TEST_SESSIONS_DB;
process.env.BCRYPT_ROUNDS = "1"; // 加速 bcrypt，測試用
process.env.SESSION_SECRET = "test-secret-only";
process.env.PASSWORD_XM2801 = ADMIN_PASS;
process.env.PASSWORD_YUCHENG = YUCHENG_PASS;
process.env.PASSWORD_DEMING = DEMING_PASS;

// 在設定 env 之後才引用 server
const { app, db, serverToday } = require("../server");

// ═══════════════════════════════════════════════════════════
// 測試常數
// ═══════════════════════════════════════════════════════════
const TODAY = serverToday(); // 與伺服器使用同一個時區（預設台北），不受測試主機時區影響
const PAST_DATE = "2024-01-15";
const EXPORT_DATE = "2024-04-01";

const GROUP_MALE_3F = "德明宿舍男 3樓";
const GROUP_FEMALE_1F = "德明宿舍女 1樓";

const TEST_STUDENTS = [
  { id: "S001", name: "張小明", roomNumber: "1231A", phoneNumber: "0912345678", group_name: GROUP_MALE_3F },
  { id: "S002", name: "李小華", roomNumber: "1232B", phoneNumber: "0912345679", group_name: GROUP_MALE_3F },
  { id: "S003", name: "王小玲", roomNumber: "2101A", phoneNumber: "0912345680", group_name: GROUP_FEMALE_1F },
];

// ═══════════════════════════════════════════════════════════
// DB 輔助函式
// ═══════════════════════════════════════════════════════════
const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

const clearAttendance = () => dbRun("DELETE FROM attendance");

// ═══════════════════════════════════════════════════════════
// 全域 Setup / Teardown
// ═══════════════════════════════════════════════════════════
let adminAgent, yuchengAgent, demingAgent;

beforeAll(async () => {
  // 建立 schema
  await dbRun(`CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password TEXT NOT NULL,
    display_name TEXT
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    roomNumber TEXT,
    phoneNumber TEXT,
    group_name TEXT
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    student_id TEXT NOT NULL,
    studentName TEXT,
    status TEXT NOT NULL,
    roomNumber TEXT
  )`);

  // 插入測試用帳號（同步 hash，確保可立即使用）
  const adminHash = bcrypt.hashSync(ADMIN_PASS, 1);
  const yuchengHash = bcrypt.hashSync(YUCHENG_PASS, 1);
  const demingHash = bcrypt.hashSync(DEMING_PASS, 1);
  await dbRun("INSERT OR REPLACE INTO users VALUES (?, ?, ?)", [ADMIN_USER, adminHash, "德銘宿舍羅老師"]);
  await dbRun("INSERT OR REPLACE INTO users VALUES (?, ?, ?)", [YUCHENG_USER, yuchengHash, "林煜晟（系統管理）"]);
  await dbRun("INSERT OR REPLACE INTO users VALUES (?, ?, ?)", [DEMING_USER, demingHash, "宿舍各樓長"]);

  // 插入測試學生
  for (const s of TEST_STUDENTS) {
    await dbRun(
      "INSERT OR REPLACE INTO students (id, name, roomNumber, phoneNumber, group_name) VALUES (?, ?, ?, ?, ?)",
      [s.id, s.name, s.roomNumber, s.phoneNumber, s.group_name]
    );
  }

  // 建立已登入的 agent（自動維持 cookie）
  adminAgent = request.agent(app);
  const adminLogin = await adminAgent.post("/api/login").send({ username: ADMIN_USER, password: ADMIN_PASS });
  expect(adminLogin.body.success).toBe(true);

  yuchengAgent = request.agent(app);
  await yuchengAgent.post("/api/login").send({ username: YUCHENG_USER, password: YUCHENG_PASS });

  demingAgent = request.agent(app);
  await demingAgent.post("/api/login").send({ username: DEMING_USER, password: DEMING_PASS });
});

afterAll(async () => {
  await new Promise((resolve) => db.close(resolve));

  const filesToClean = [
    TEST_DB,
    path.resolve(__dirname, "..", TEST_SESSIONS_DB),
  ];
  for (const f of filesToClean) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch (_) {}
  }
});

// ═══════════════════════════════════════════════════════════
// 1. 驗證（Auth）
// ═══════════════════════════════════════════════════════════
describe("Auth", () => {
  test("POST /api/login - 正確管理員帳密 → 200 success", async () => {
    const res = await request(app)
      .post("/api/login")
      .send({ username: ADMIN_USER, password: ADMIN_PASS });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.username).toBe(ADMIN_USER);
  });

  test("POST /api/login - 正確樓長帳密 → 200 success", async () => {
    const res = await request(app)
      .post("/api/login")
      .send({ username: DEMING_USER, password: DEMING_PASS });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("POST /api/login - 密碼錯誤 → 401", async () => {
    const res = await request(app)
      .post("/api/login")
      .send({ username: ADMIN_USER, password: "wrongpassword" });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test("POST /api/login - 帳號不存在 → 401", async () => {
    const res = await request(app)
      .post("/api/login")
      .send({ username: "nobody", password: "anything" });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test("POST /api/login - 缺少欄位 → 400", async () => {
    const res = await request(app)
      .post("/api/login")
      .send({ username: ADMIN_USER });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test("GET /api/check-login - 已登入狀態", async () => {
    const res = await adminAgent.get("/api/check-login");
    expect(res.status).toBe(200);
    expect(res.body.loggedIn).toBe(true);
    expect(res.body.user.username).toBe(ADMIN_USER);
  });

  test("GET /api/check-login - 未登入狀態", async () => {
    const res = await request(app).get("/api/check-login");
    expect(res.status).toBe(200);
    expect(res.body.loggedIn).toBe(false);
  });

  test("POST /api/logout - 登出後 session 清除", async () => {
    const tempAgent = request.agent(app);
    await tempAgent.post("/api/login").send({ username: ADMIN_USER, password: ADMIN_PASS });

    const logoutRes = await tempAgent.post("/api/logout");
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.success).toBe(true);

    const checkRes = await tempAgent.get("/api/check-login");
    expect(checkRes.body.loggedIn).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// 2. 中介軟體（Middleware）
// ═══════════════════════════════════════════════════════════
describe("Auth Middleware", () => {
  test("未登入呼叫受保護 API → 401", async () => {
    const res = await request(app).get("/api/groups");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test("未登入存取受保護頁面 → 401", async () => {
    const res = await request(app).get("/history.html");
    expect(res.status).toBe(401);
  });

  test("樓長存取受保護頁面 → 403", async () => {
    const res = await demingAgent.get("/history.html");
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/無權限/);
  });

  test("樓長存取 add_student.html → 403", async () => {
    const res = await demingAgent.get("/add_student.html");
    expect(res.status).toBe(403);
  });

  test("管理員可正常存取受保護頁面", async () => {
    const res = await adminAgent.get("/history.html");
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════
// 3. 學生 API
// ═══════════════════════════════════════════════════════════
describe("Students API", () => {
  test("GET /api/groups - 回傳群組清單", async () => {
    const res = await adminAgent.get("/api/groups");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toContain(GROUP_MALE_3F);
    expect(res.body).toContain(GROUP_FEMALE_1F);
  });

  test("GET /api/students/all?group=X - 回傳該群組學生", async () => {
    const res = await adminAgent.get(
      `/api/students/all?group=${encodeURIComponent(GROUP_MALE_3F)}`
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
    const ids = res.body.map((s) => s.id);
    expect(ids).toContain("S001");
    expect(ids).toContain("S002");
    expect(res.body[0]).toHaveProperty("roomNumber");
    expect(res.body[0]).toHaveProperty("phoneNumber");
  });

  test("GET /api/students/all - 缺少 group 參數 → 400", async () => {
    const res = await adminAgent.get("/api/students/all");
    expect(res.status).toBe(400);
  });

  test("GET /api/students/all - 不存在的群組 → 空陣列", async () => {
    const res = await adminAgent.get("/api/students/all?group=不存在的群組");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test("GET /api/student/search?id=S001 - 找到學生", async () => {
    const res = await adminAgent.get("/api/student/search?id=S001");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("張小明");
    expect(res.body.data).toHaveProperty("group_name");
    expect(res.body.data).toHaveProperty("today_status");
  });

  test("GET /api/student/search?id=NOTEXIST - 找不到 → 404", async () => {
    const res = await adminAgent.get("/api/student/search?id=NOTEXIST");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test("GET /api/student/search - 缺少 id → 400", async () => {
    const res = await adminAgent.get("/api/student/search");
    expect(res.status).toBe(400);
  });

  test("GET /api/student/history?id=S001 - 回傳歷史陣列", async () => {
    const res = await adminAgent.get("/api/student/history?id=S001");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test("GET /api/student/history - 缺少 id → 400", async () => {
    const res = await adminAgent.get("/api/student/history");
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════
// 4. 點名送出
// ═══════════════════════════════════════════════════════════
describe("Attendance Submit", () => {
  afterEach(clearAttendance);

  const makePayload = (ids = ["S001", "S002"], status = "在寢") => ({
    date: TODAY,
    group: GROUP_MALE_3F,
    attendanceData: ids.map((id) => ({
      student_id: id,
      studentName: TEST_STUDENTS.find((s) => s.id === id)?.name || id,
      status,
    })),
  });

  test("送出新點名資料 → success", async () => {
    const res = await adminAgent.post("/api/attendance/submit").send(makePayload());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const count = await dbGet("SELECT COUNT(*) as c FROM attendance WHERE date = ?", [TODAY]);
    expect(count.c).toBe(2);
  });

  test("送出多種狀態（在寢/未歸/晚歸）→ success", async () => {
    const res = await adminAgent.post("/api/attendance/submit").send({
      date: TODAY,
      group: GROUP_MALE_3F,
      attendanceData: [
        { student_id: "S001", studentName: "張小明", status: "在寢" },
        { student_id: "S002", studentName: "李小華", status: "未歸" },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const absent = await dbGet(
      "SELECT status FROM attendance WHERE student_id = ? AND date = ?",
      ["S002", TODAY]
    );
    expect(absent.status).toBe("未歸");
  });

  test("缺少 date 欄位 → 400", async () => {
    const res = await adminAgent.post("/api/attendance/submit").send({
      group: GROUP_MALE_3F,
      attendanceData: makePayload().attendanceData,
    });
    expect(res.status).toBe(400);
  });

  test("缺少 attendanceData 欄位 → 400", async () => {
    const res = await adminAgent.post("/api/attendance/submit").send({
      date: TODAY,
      group: GROUP_MALE_3F,
    });
    expect(res.status).toBe(400);
  });

  test("防止重複點名：所有學生均已點名時重送 → 409 且不新增紀錄", async () => {
    // 第一次送出
    await adminAgent.post("/api/attendance/submit").send(makePayload());
    const before = await dbGet("SELECT COUNT(*) as c FROM attendance WHERE date = ?", [TODAY]);

    // 第二次送出（即使狀態不同也不可覆蓋或新增）
    const payload = makePayload();
    payload.attendanceData.forEach((s) => { s.status = "未歸"; });
    const res = await adminAgent.post("/api/attendance/submit").send(payload);
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/均已點名/);

    const after = await dbGet("SELECT COUNT(*) as c FROM attendance WHERE date = ?", [TODAY]);
    expect(after.c).toBe(before.c);
  });

  test("部分學生已點名 → 只插入新的，舊的不重複", async () => {
    // 先只點 S001
    await adminAgent.post("/api/attendance/submit").send(makePayload(["S001"]));

    // 再送 S001 + S002（S001 已存在，只應插入 S002）
    const res = await adminAgent.post("/api/attendance/submit").send(makePayload(["S001", "S002"]));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const count = await dbGet("SELECT COUNT(*) as c FROM attendance WHERE date = ?", [TODAY]);
    expect(count.c).toBe(2); // 不是 3
  });

  test("驗證：無效的 status → 400 且不寫入", async () => {
    const res = await adminAgent.post("/api/attendance/submit").send(makePayload(["S001"], "亂寫"));
    expect(res.status).toBe(400);
    const count = await dbGet("SELECT COUNT(*) as c FROM attendance");
    expect(count.c).toBe(0);
  });

  test("驗證：status 為 null → 400", async () => {
    const payload = makePayload(["S001"]);
    payload.attendanceData[0].status = null;
    const res = await adminAgent.post("/api/attendance/submit").send(payload);
    expect(res.status).toBe(400);
  });

  test("驗證：空的 attendanceData → 400", async () => {
    const res = await adminAgent.post("/api/attendance/submit").send({
      date: TODAY, group: GROUP_MALE_3F, attendanceData: [],
    });
    expect(res.status).toBe(400);
  });

  test("驗證：同一 payload 重複學號 → 400 且不寫入", async () => {
    const payload = makePayload(["S001", "S001"]);
    const res = await adminAgent.post("/api/attendance/submit").send(payload);
    expect(res.status).toBe(400);
    const count = await dbGet("SELECT COUNT(*) as c FROM attendance");
    expect(count.c).toBe(0);
  });

  test("驗證：學生不屬於指定群組 → 400 且不寫入", async () => {
    const res = await adminAgent.post("/api/attendance/submit").send(makePayload(["S001", "S003"]));
    expect(res.status).toBe(400);
    const count = await dbGet("SELECT COUNT(*) as c FROM attendance");
    expect(count.c).toBe(0);
  });

  test("驗證：日期格式錯誤（含空白、非法日期）→ 400", async () => {
    for (const bad of [`${TODAY} `, "2026-02-30", "2026/09/21", "abc"]) {
      const payload = makePayload(["S001"]);
      payload.date = bad;
      const res = await adminAgent.post("/api/attendance/submit").send(payload);
      expect(res.status).toBe(400);
    }
    const count = await dbGet("SELECT COUNT(*) as c FROM attendance");
    expect(count.c).toBe(0);
  });

  test("驗證：未來日期 → 400", async () => {
    const payload = makePayload(["S001"]);
    payload.date = "2999-01-01";
    const res = await adminAgent.post("/api/attendance/submit").send(payload);
    expect(res.status).toBe(400);
  });

  test("補點名：過去日期可正常送出，並記錄實際送出時間 created_at", async () => {
    const payload = makePayload(["S001", "S002"]);
    payload.date = "2024-03-01";
    const res = await adminAgent.post("/api/attendance/submit").send(payload);
    expect(res.status).toBe(200);
    const row = await dbGet("SELECT date, created_at FROM attendance WHERE student_id = 'S001'");
    expect(row.date).toBe("2024-03-01");
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(row.created_at.slice(0, 10)).toBe(TODAY); // 送出時間是今天，點名日期是過去
  });

  test("資料庫層級：(date, student_id) 唯一索引確實存在，且直接重複寫入會被拒絕", async () => {
    await adminAgent.post("/api/attendance/submit").send(makePayload(["S001"]));
    const idx = await dbGet(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_attendance_date_student'"
    );
    expect(idx).toBeTruthy();
    await expect(
      dbRun(
        "INSERT INTO attendance (date, student_id, studentName, status, roomNumber) VALUES (?, 'S001', 'x', '在寢', 'x')",
        [TODAY]
      )
    ).rejects.toThrow(/UNIQUE/i);
  });

  test("併發：同一群組同時送出兩次 → 一次成功、一次 409，且只有一份紀錄", async () => {
    const [r1, r2] = await Promise.all([
      adminAgent.post("/api/attendance/submit").send(makePayload(["S001", "S002"], "在寢")),
      demingAgent.post("/api/attendance/submit").send(makePayload(["S001", "S002"], "未歸")),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const count = await dbGet("SELECT COUNT(*) as c FROM attendance WHERE date = ?", [TODAY]);
    expect(count.c).toBe(2);
    // 兩位學生的狀態必須全部來自同一次成功的請求，不會混合
    const rows = await new Promise((resolve, reject) =>
      db.all("SELECT DISTINCT status FROM attendance WHERE date = ?", [TODAY], (e, r) => (e ? reject(e) : resolve(r)))
    );
    expect(rows.length).toBe(1);
  });

  test("部分點名後補點其餘學生 → 回報 inserted / skipped", async () => {
    await adminAgent.post("/api/attendance/submit").send(makePayload(["S001"], "未歸"));
    const res = await adminAgent.post("/api/attendance/submit").send(makePayload(["S001", "S002"], "在寢"));
    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(1);
    expect(res.body.skipped).toBe(1);
    // 已點名的 S001 不可被覆蓋
    const s1 = await dbGet("SELECT status FROM attendance WHERE student_id = 'S001' AND date = ?", [TODAY]);
    expect(s1.status).toBe("未歸");
  });

  test("check：部分點名 → completed:false，並列出 marked_ids；補齊後 completed:true", async () => {
    const q = `/api/attendance/check?group=${encodeURIComponent(GROUP_MALE_3F)}`;

    let res = await adminAgent.get(q);
    expect(res.body.date).toBe(TODAY); // 不帶 date 時以伺服器今天為準
    expect(res.body.completed).toBe(false);
    expect(res.body.marked).toBe(0);

    await adminAgent.post("/api/attendance/submit").send(makePayload(["S001"]));
    res = await adminAgent.get(q);
    expect(res.body.exists).toBe(true);
    expect(res.body.completed).toBe(false);
    expect(res.body.marked).toBe(1);
    expect(res.body.total).toBe(2);
    expect(res.body.marked_ids).toEqual(["S001"]);

    await adminAgent.post("/api/attendance/submit").send(makePayload(["S001", "S002"]));
    res = await adminAgent.get(q);
    expect(res.body.completed).toBe(true);
  });

  test("409 訊息誠實：只送已點名的學生時，不宣稱整組完成", async () => {
    await adminAgent.post("/api/attendance/submit").send(makePayload(["S001"]));
    const res = await adminAgent.post("/api/attendance/submit").send(makePayload(["S001"]));
    expect(res.status).toBe(409);
    expect(res.body.error).not.toMatch(/此群組/);
    // 實際上 S002 尚未點名，check 也必須回報未完成
    const chk = await adminAgent.get(`/api/attendance/check?group=${encodeURIComponent(GROUP_MALE_3F)}`);
    expect(chk.body.completed).toBe(false);
  });

  test("check：未來日期 → 400", async () => {
    const res = await adminAgent.get(
      `/api/attendance/check?date=2999-01-01&group=${encodeURIComponent(GROUP_MALE_3F)}`
    );
    expect(res.status).toBe(400);
  });

  test("check：日期格式錯誤 → 400", async () => {
    const res = await adminAgent.get(
      `/api/attendance/check?date=bad&group=${encodeURIComponent(GROUP_MALE_3F)}`
    );
    expect(res.status).toBe(400);
  });

  // 讓「預查已通過、寫入前才被別人搶先寫入」的情境可確定地重現（不靠 Promise.all 碰運氣）
  const injectAfterPrecheck = (rowsToInsert) => {
    const realAll = db.all.bind(db);
    let injected = false;
    return jest.spyOn(db, "all").mockImplementation((sql, params, cb) => {
      if (!injected && typeof sql === "string" && sql.includes("SELECT student_id FROM attendance WHERE date")) {
        injected = true;
        return realAll(sql, params, (err, rows) => {
          // 預查回傳的是「尚未有人點名」，此時另一個請求搶先寫入
          let pending = rowsToInsert.length;
          rowsToInsert.forEach(([id, name, status, room]) =>
            db.run(
              "INSERT INTO attendance (date, student_id, studentName, status, roomNumber) VALUES (?, ?, ?, ?, ?)",
              [TODAY, id, name, status, room],
              () => { if (--pending === 0) cb(err, rows); }
            )
          );
        });
      }
      return realAll(sql, params, cb);
    });
  };

  test("寫入衝突分支：預查後部分學生被搶先寫入 → 只寫入其餘、回報 inserted/skipped、不覆蓋", async () => {
    const spy = injectAfterPrecheck([["S001", "張小明", "未歸", "1231A"]]);
    let res;
    try {
      res = await adminAgent.post("/api/attendance/submit").send(makePayload(["S001", "S002"], "在寢"));
    } finally {
      spy.mockRestore();
    }
    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(1);
    expect(res.body.skipped).toBe(1);
    const s1 = await dbGet("SELECT status FROM attendance WHERE student_id = 'S001' AND date = ?", [TODAY]);
    const s2 = await dbGet("SELECT status FROM attendance WHERE student_id = 'S002' AND date = ?", [TODAY]);
    expect(s1.status).toBe("未歸"); // 先寫入者保留
    expect(s2.status).toBe("在寢");
  });

  test("寫入衝突分支：預查後全部被搶先寫入 → 409（不誤報成功）", async () => {
    const spy = injectAfterPrecheck([
      ["S001", "張小明", "未歸", "1231A"],
      ["S002", "李小華", "未歸", "1232B"],
    ]);
    let res;
    try {
      res = await adminAgent.post("/api/attendance/submit").send(makePayload(["S001", "S002"], "在寢"));
    } finally {
      spy.mockRestore();
    }
    expect(res.status).toBe(409);
    expect(res.body.inserted).toBe(0);
    const count = await dbGet("SELECT COUNT(*) as c FROM attendance WHERE date = ?", [TODAY]);
    expect(count.c).toBe(2);
    const rows = await dbGet("SELECT COUNT(*) as c FROM attendance WHERE date = ? AND status = '在寢'", [TODAY]);
    expect(rows.c).toBe(0); // 沒有任何一筆被後者覆蓋
  });

  test("樓長也可以送出點名", async () => {
    const res = await demingAgent.post("/api/attendance/submit").send(makePayload(["S001"]));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// 5. 點名查詢
// ═══════════════════════════════════════════════════════════
describe("Attendance Query", () => {
  beforeAll(async () => {
    // 插入測試用歷史資料
    const rows = [
      [PAST_DATE, "S001", "張小明", "在寢", "1231A"],
      [PAST_DATE, "S002", "李小華", "未歸", "1232B"],
      [PAST_DATE, "S003", "王小玲", "晚歸", "2101A"],
    ];
    for (const r of rows) {
      await dbRun(
        "INSERT INTO attendance (date, student_id, studentName, status, roomNumber) VALUES (?, ?, ?, ?, ?)",
        r
      );
    }
  });

  afterAll(clearAttendance);

  test("GET /api/attendance/dates - 回傳日期陣列", async () => {
    const res = await adminAgent.get("/api/attendance/dates");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toContain(PAST_DATE);
  });

  test("GET /api/attendance/history - 回傳分頁資料結構", async () => {
    const res = await adminAgent.get("/api/attendance/history");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty("total");
    expect(res.body).toHaveProperty("page");
    expect(res.body).toHaveProperty("totalPages");
    expect(res.body).toHaveProperty("summary");
    expect(res.body.summary).toHaveProperty("在寢");
    expect(res.body.summary).toHaveProperty("未歸");
    expect(res.body.summary).toHaveProperty("晚歸");
  });

  test("GET /api/attendance/history?date=X - 按日期篩選", async () => {
    const res = await adminAgent.get(`/api/attendance/history?date=${PAST_DATE}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(3);
    expect(res.body.data.every((r) => r.date === PAST_DATE)).toBe(true);
  });

  test("GET /api/attendance/history?group=X - 按群組篩選", async () => {
    const res = await adminAgent.get(
      `/api/attendance/history?group=${encodeURIComponent(GROUP_MALE_3F)}`
    );
    expect(res.status).toBe(200);
    // S001, S002 屬於 GROUP_MALE_3F
    expect(res.body.data.length).toBe(2);
  });

  test("summary 統計正確（在寢:1 未歸:1 晚歸:1）", async () => {
    const res = await adminAgent.get(`/api/attendance/history?date=${PAST_DATE}`);
    expect(res.body.summary["在寢"]).toBe(1);
    expect(res.body.summary["未歸"]).toBe(1);
    expect(res.body.summary["晚歸"]).toBe(1);
  });

  test("GET /api/attendance/history 分頁結構正確（server 最小 pageSize=10）", async () => {
    const res = await adminAgent.get(
      `/api/attendance/history?date=${PAST_DATE}&pageSize=10&page=1`
    );
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.total).toBe(3);
    expect(res.body.totalPages).toBe(1); // ceil(3/10) = 1
    expect(res.body.data.length).toBe(3);
  });

  test("GET /api/attendance/check - 該群組當日有紀錄 → exists: true", async () => {
    const res = await adminAgent.get(
      `/api/attendance/check?date=${PAST_DATE}&group=${encodeURIComponent(GROUP_MALE_3F)}`
    );
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(true);
    expect(res.body.count).toBe(2);
    expect(res.body.completed).toBe(true); // 該群組 2 人皆已點名
  });

  test("GET /api/attendance/check - 該群組無紀錄 → exists: false", async () => {
    const res = await adminAgent.get(
      `/api/attendance/check?date=2020-01-01&group=${encodeURIComponent(GROUP_MALE_3F)}`
    );
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(false);
  });

  test("GET /api/attendance/check - 缺少參數 → 400", async () => {
    const res = await adminAgent.get(`/api/attendance/check?date=${PAST_DATE}`);
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════
// 6. 點名修改
// ═══════════════════════════════════════════════════════════
describe("Attendance Update", () => {
  const UPDATE_DATE = "2024-02-01";

  beforeEach(() =>
    dbRun(
      "INSERT INTO attendance (date, student_id, studentName, status, roomNumber) VALUES (?, ?, ?, ?, ?)",
      [UPDATE_DATE, "S001", "張小明", "在寢", "1231A"]
    )
  );
  afterEach(clearAttendance);

  test("PATCH /api/attendance/update - 成功更新狀態", async () => {
    const res = await adminAgent
      .patch("/api/attendance/update")
      .send({ student_id: "S001", date: UPDATE_DATE, status: "未歸" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const row = await dbGet(
      "SELECT status FROM attendance WHERE student_id = ? AND date = ?",
      ["S001", UPDATE_DATE]
    );
    expect(row.status).toBe("未歸");
  });

  test("PATCH /api/attendance/update - 找不到紀錄 → 404", async () => {
    const res = await adminAgent
      .patch("/api/attendance/update")
      .send({ student_id: "S999", date: UPDATE_DATE, status: "在寢" });
    expect(res.status).toBe(404);
  });

  test("PATCH /api/attendance/update - 缺少 status → 400", async () => {
    const res = await adminAgent
      .patch("/api/attendance/update")
      .send({ student_id: "S001", date: UPDATE_DATE });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════
// 7. 點名刪除
// ═══════════════════════════════════════════════════════════
describe("Attendance Delete", () => {
  const DEL_DATE = "2024-03-01";

  beforeEach(async () => {
    await dbRun(
      "INSERT INTO attendance (date, student_id, studentName, status, roomNumber) VALUES (?, ?, ?, ?, ?)",
      [DEL_DATE, "S001", "張小明", "在寢", "1231A"]
    );
    await dbRun(
      "INSERT INTO attendance (date, student_id, studentName, status, roomNumber) VALUES (?, ?, ?, ?, ?)",
      [DEL_DATE, "S002", "李小華", "在寢", "1232B"]
    );
  });
  afterEach(clearAttendance);

  test("DELETE /api/attendance/delete - 管理員可刪除", async () => {
    const res = await adminAgent.delete(
      `/api/attendance/delete?student_id=S001&date=${DEL_DATE}`
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const row = await dbGet(
      "SELECT * FROM attendance WHERE student_id = ? AND date = ?",
      ["S001", DEL_DATE]
    );
    expect(row).toBeUndefined();
  });

  test("DELETE /api/attendance/delete - 樓長無權限 → 403", async () => {
    const res = await demingAgent.delete(
      `/api/attendance/delete?student_id=S001&date=${DEL_DATE}`
    );
    expect(res.status).toBe(403);
  });

  test("DELETE /api/attendance/delete - 找不到紀錄 → 404", async () => {
    const res = await adminAgent.delete(
      `/api/attendance/delete?student_id=S999&date=${DEL_DATE}`
    );
    expect(res.status).toBe(404);
  });

  test("DELETE /api/attendance/delete - 缺少 date → 400", async () => {
    const res = await adminAgent.delete("/api/attendance/delete?student_id=S001");
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════
// 8. 清除所有紀錄
// ═══════════════════════════════════════════════════════════
describe("Attendance Clear", () => {
  beforeEach(() =>
    dbRun(
      "INSERT INTO attendance (date, student_id, studentName, status, roomNumber) VALUES (?, ?, ?, ?, ?)",
      [TODAY, "S001", "張小明", "在寢", "1231A"]
    )
  );
  afterEach(clearAttendance);

  test("DELETE /api/attendance/clear - 樓長無權限 → 403", async () => {
    const res = await demingAgent.delete("/api/attendance/clear");
    expect(res.status).toBe(403);

    const count = await dbGet("SELECT COUNT(*) as c FROM attendance");
    expect(count.c).toBe(1); // 資料未被刪除
  });

  test("DELETE /api/attendance/clear - 管理員可清除全部", async () => {
    const res = await adminAgent.delete("/api/attendance/clear");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const count = await dbGet("SELECT COUNT(*) as c FROM attendance");
    expect(count.c).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
// 9. Excel 匯出
// ═══════════════════════════════════════════════════════════
describe("Attendance Export", () => {
  // 共用資料在 setup 建立，讓每個案例都能單獨執行：
  // EXPORT_DATE 1 筆 + 2024-05-01 / 2024-05-02 各 60 筆 = 121 筆
  beforeAll(async () => {
    await dbRun(
      "INSERT INTO attendance (date, student_id, studentName, status, roomNumber) VALUES (?, ?, ?, ?, ?)",
      [EXPORT_DATE, "S001", "張小明", "在寢", "1231A"]
    );
    for (const date of ["2024-05-01", "2024-05-02"]) {
      for (let i = 1; i <= 60; i++) {
        await dbRun(
          "INSERT INTO attendance (date, student_id, studentName, status, roomNumber) VALUES (?, ?, ?, ?, ?)",
          [date, `E${i}`, `測試${i}`, "在寢", "9999"]
        );
      }
    }
  });
  afterAll(clearAttendance);
  // 個別案例額外插入的日期在案例結束後清掉，避免影響其他案例的筆數
  afterEach(() =>
    dbRun("DELETE FROM attendance WHERE date IN ('2024-06-01', '2024-07-01', '2024-08-01')")
  );

  test("GET /api/attendance/export?date=X - 回傳 xlsx 檔案", async () => {
    const res = await adminAgent.get(`/api/attendance/export?date=${EXPORT_DATE}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/spreadsheetml/);
    expect(res.headers["content-disposition"]).toMatch(/attendance_.*\.xlsx/);
  });

  const parseXlsx = async (res) => {
    const ExcelJS = require("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    return wb.worksheets[0];
  };
  const binaryParser = (res, cb) => {
    const chunks = [];
    res.on("data", (d) => chunks.push(d));
    res.on("end", () => cb(null, Buffer.concat(chunks)));
  };

  test("GET /api/attendance/export - 不選日期 → 一次匯出全部（不受每頁 50 筆限制）", async () => {
    const res = await adminAgent.get("/api/attendance/export").buffer().parse(binaryParser);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attendance_all_.*\.xlsx/);
    const sheet = await parseXlsx(res);
    expect(sheet.rowCount - 1).toBe(121); // 扣掉標題列
  });

  test("GET /api/attendance/export - 只選日期 → 只匯出該日", async () => {
    const res = await adminAgent.get("/api/attendance/export?date=2024-05-01").buffer().parse(binaryParser);
    const sheet = await parseXlsx(res);
    expect(sheet.rowCount - 1).toBe(60);
  });

  test("GET /api/attendance/export - 日期格式錯誤 → 400", async () => {
    const res = await adminAgent.get("/api/attendance/export?date=abc");
    expect(res.status).toBe(400);
  });

  test("CSV：不選日期 → 一次匯出全部（含 BOM、標題列 + 121 筆）", async () => {
    const res = await adminAgent.get("/api/attendance/export?format=csv");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    // 注意：String.trim() 會把開頭的 BOM 一併去掉，所以只移除結尾換行
    const lines = res.text.replace(/\r\n$/, "").split("\r\n");
    expect(lines[0]).toBe("\uFEFF日期,房號,學生姓名,狀態");
    expect(lines.length - 1).toBe(121);
  });

  test("CSV：欄位含雙引號、逗號、公式開頭時正確跳脫", async () => {
    await dbRun(
      "INSERT INTO attendance (date, student_id, studentName, status, roomNumber) VALUES (?, ?, ?, ?, ?)",
      ["2024-06-01", "Q1", 'He said "hi", ok', "在寢", "1"]
    );
    await dbRun(
      "INSERT INTO attendance (date, student_id, studentName, status, roomNumber) VALUES (?, ?, ?, ?, ?)",
      ["2024-06-01", "Q2", "=SUM(1+1)", "未歸", "2"]
    );
    const res = await adminAgent.get("/api/attendance/export?format=csv&date=2024-06-01");
    expect(res.status).toBe(200);
    expect(res.text).toContain('"He said ""hi"", ok"');
    expect(res.text).toContain(`"'=SUM(1+1)"`); // 前綴 ' 避免被試算表當成公式
    expect(res.text.trim().split("\r\n").length).toBe(3); // 標題 + 2 筆
  });

  test("匯出：群組篩選 + 中文群組名稱檔名（RFC 5987）", async () => {
    const res = await adminAgent.get(
      `/api/attendance/export?format=csv&date=${EXPORT_DATE}&group=${encodeURIComponent(GROUP_MALE_3F)}`
    );
    expect(res.status).toBe(200);
    const disposition = res.headers["content-disposition"];
    expect(disposition).toMatch(/filename="attendance_2024-04-01\.csv"/);
    expect(disposition).toContain("filename*=UTF-8''" + encodeURIComponent(`attendance_${EXPORT_DATE}_${GROUP_MALE_3F}.csv`));
    expect(res.text.trim().split("\r\n").length).toBe(2); // 只有 S001 那一筆
  });

  test("匯出：檔名 filename* 也編碼 ' ( ) * 等 RFC 8187 不允許的字元", async () => {
    const weird = "A'組(夜)*";
    await dbRun(
      "INSERT OR REPLACE INTO students (id, name, roomNumber, phoneNumber, group_name) VALUES ('W1', '特殊', '5', '0', ?)",
      [weird]
    );
    await dbRun(
      "INSERT INTO attendance (date, student_id, studentName, status, roomNumber) VALUES (?, 'W1', '特殊', '在寢', '5')",
      ["2024-07-01"]
    );
    const res = await adminAgent.get(
      `/api/attendance/export?format=csv&date=2024-07-01&group=${encodeURIComponent(weird)}`
    );
    expect(res.status).toBe(200);
    const m = res.headers["content-disposition"].match(/filename\*=UTF-8''(\S+)$/);
    expect(m[1]).not.toMatch(/['()*]/);
    expect(decodeURIComponent(m[1])).toBe(`attendance_2024-07-01_${weird}.csv`);
    await dbRun("DELETE FROM students WHERE id = 'W1'");
  });

  test("CSV：換行或全形符號開頭的欄位也加單引號防公式注入", async () => {
    await dbRun(
      "INSERT INTO attendance (date, student_id, studentName, status, roomNumber) VALUES (?, 'F1', ?, '在寢', '1')",
      ["2024-08-01", "\n=1+1"]
    );
    await dbRun(
      "INSERT INTO attendance (date, student_id, studentName, status, roomNumber) VALUES (?, 'F2', ?, '在寢', '1')",
      ["2024-08-01", "＝1+1"]
    );
    const res = await adminAgent.get("/api/attendance/export?format=csv&date=2024-08-01");
    expect(res.text).toContain(`"'\n=1+1"`);
    expect(res.text).toContain(`"'＝1+1"`);
  });

  test("匯出：篩選後沒有資料 → 404（不下載空檔案）", async () => {
    const res = await adminAgent.get(
      `/api/attendance/export?format=csv&date=${EXPORT_DATE}&group=${encodeURIComponent(GROUP_FEMALE_1F)}`
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/無可匯出/);
  });

  test("GET /api/server-date - 回傳伺服器認定的今天", async () => {
    const res = await adminAgent.get("/api/server-date");
    expect(res.status).toBe(200);
    expect(res.body.date).toBe(TODAY);
  });
});

// ═══════════════════════════════════════════════════════════
// 10. 修改密碼
// ═══════════════════════════════════════════════════════════
describe("Change Password", () => {
  const NEW_PASS = "newpassword999";

  // 測試結束後恢復原密碼
  afterAll(async () => {
    const hash = bcrypt.hashSync(YUCHENG_PASS, 1);
    await dbRun("UPDATE users SET password = ? WHERE username = ?", [hash, YUCHENG_USER]);
  });

  test("POST /api/change-password - 樓長無權限 → 403", async () => {
    const res = await demingAgent
      .post("/api/change-password")
      .send({ oldPassword: DEMING_PASS, newPassword: "newdeming999" });
    expect(res.status).toBe(403);
  });

  test("POST /api/change-password - 新密碼太短 → 400", async () => {
    const res = await yuchengAgent
      .post("/api/change-password")
      .send({ oldPassword: YUCHENG_PASS, newPassword: "abc" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/6/);
  });

  test("POST /api/change-password - 缺少欄位 → 400", async () => {
    const res = await yuchengAgent
      .post("/api/change-password")
      .send({ oldPassword: YUCHENG_PASS });
    expect(res.status).toBe(400);
  });

  test("POST /api/change-password - 舊密碼錯誤 → 401", async () => {
    const res = await yuchengAgent
      .post("/api/change-password")
      .send({ oldPassword: "wrongoldpass", newPassword: NEW_PASS });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/舊密碼/);
  });

  test("POST /api/change-password - 成功修改，新密碼可登入", async () => {
    const res = await yuchengAgent
      .post("/api/change-password")
      .send({ oldPassword: YUCHENG_PASS, newPassword: NEW_PASS });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // 驗證新密碼可登入
    const loginRes = await request(app)
      .post("/api/login")
      .send({ username: YUCHENG_USER, password: NEW_PASS });
    expect(loginRes.body.success).toBe(true);

    // 驗證舊密碼無效
    const oldLoginRes = await request(app)
      .post("/api/login")
      .send({ username: YUCHENG_USER, password: YUCHENG_PASS });
    expect(oldLoginRes.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════
// 11. 學生匯入（Excel）
// ═══════════════════════════════════════════════════════════
describe("Students Import", () => {
  const ExcelJS = require("exceljs");

  // 建立測試用 Excel buffer
  const makeExcelBuffer = async (rows) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["性別", "學號", "姓名", "房號", "床", "電話"]);
    rows.forEach((r) => ws.addRow(r));
    return wb.xlsx.writeBuffer();
  };

  // 測試結束後清除並恢復原測試學生
  afterAll(async () => {
    await dbRun("DELETE FROM students");
    for (const s of TEST_STUDENTS) {
      await dbRun(
        "INSERT OR REPLACE INTO students (id, name, roomNumber, phoneNumber, group_name) VALUES (?, ?, ?, ?, ?)",
        [s.id, s.name, s.roomNumber, s.phoneNumber, s.group_name]
      );
    }
  });

  test("樓長無法匯入 → 403", async () => {
    const buf = await makeExcelBuffer([["男", "T001", "測試生", "1231", "A", "0900000001"]]);
    const res = await demingAgent
      .post("/api/students/import")
      .attach("file", Buffer.from(buf), "students.xlsx");
    expect(res.status).toBe(403);
  });

  test("缺少必要欄位的 Excel → 400", async () => {
    // 缺少「床」欄位
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["性別", "學號", "姓名", "房號"]); // 缺少「床」
    ws.addRow(["男", "T001", "測試生", "1231"]);
    const buf = await wb.xlsx.writeBuffer();

    const res = await adminAgent
      .post("/api/students/import")
      .attach("file", Buffer.from(buf), "students.xlsx");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/缺少欄位/);
  });

  test("正常匯入 → 取代所有舊資料", async () => {
    // 確認先有舊資料（TEST_STUDENTS: S001, S002, S003）
    const before = await dbGet("SELECT COUNT(*) as c FROM students");
    expect(before.c).toBe(3);

    // 匯入只含 2 位新學生的 Excel
    const buf = await makeExcelBuffer([
      ["男", "N001", "新生甲", "2231", "A", "0900000001"],
      ["女", "N002", "新生乙", "2201", "B", "0900000002"],
    ]);
    const res = await adminAgent
      .post("/api/students/import")
      .attach("file", Buffer.from(buf), "students.xlsx");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/2/);

    // 舊的 3 筆應已被清除，只剩新的 2 筆
    const after = await dbGet("SELECT COUNT(*) as c FROM students");
    expect(after.c).toBe(2);

    // 確認舊學生（S001）不存在
    const old = await dbGet("SELECT * FROM students WHERE id = 'S001'");
    expect(old).toBeUndefined();

    // 確認新學生存在
    const newStudent = await dbGet("SELECT * FROM students WHERE id = 'N001'");
    expect(newStudent.name).toBe("新生甲");
    expect(newStudent.roomNumber).toBe("2231A");
    expect(newStudent.group_name).toBe("德明宿舍男 1樓");
  });

  test("未上傳檔案 → 400", async () => {
    const res = await adminAgent.post("/api/students/import");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/未上傳/);
  });
});

// ═══════════════════════════════════════════════════════════
// 13. 安全性 - 封鎖敏感路徑
// ═══════════════════════════════════════════════════════════
describe("Security - Blocked Paths", () => {
  test("GET /.env → 403", async () => {
    const res = await request(app).get("/.env");
    expect(res.status).toBe(403);
  });

  test("GET /server.js → 403", async () => {
    const res = await request(app).get("/server.js");
    expect(res.status).toBe(403);
  });

  test("GET /package.json → 403", async () => {
    const res = await request(app).get("/package.json");
    expect(res.status).toBe(403);
  });

  test("GET /dormitory.db → 403", async () => {
    const res = await request(app).get("/dormitory.db");
    expect(res.status).toBe(403);
  });

  test("GET /sessions.db → 403", async () => {
    const res = await request(app).get("/sessions.db");
    expect(res.status).toBe(403);
  });

  test("GET /package-lock.json → 403", async () => {
    const res = await request(app).get("/package-lock.json");
    expect(res.status).toBe(403);
  });
});
