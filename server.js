require("dotenv").config();
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const path = require("path");
const bcrypt = require("bcrypt");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const SQLiteStore = require("connect-sqlite3")(session);
const multer = require("multer");
const ExcelJS = require("exceljs");
const stream = require("stream");

const app = express();
const port = process.env.PORT || 3000;
const host = "0.0.0.0";
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 10;
const DB_PATH = process.env.TEST_DB || "./dormitory.db";
const SESSION_DB_NAME = process.env.SESSION_DB_NAME || "sessions.db";

const upload = multer({ storage: multer.memoryStorage() });

app.use(cookieParser());
app.use(bodyParser.json());

// 封鎖敏感檔案的直接存取
const BLOCKED_PATHS = [
  ".env", "ini.env", "server.js", "package.json", "package-lock.json",
  "cookies.txt", ".db",
];
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  const isBlocked = BLOCKED_PATHS.some(
    (blocked) => p === "/" + blocked || p.endsWith(blocked)
  );
  if (isBlocked) return res.status(403).send("Forbidden");
  next();
});

app.use(
  session({
    store: new SQLiteStore({ db: SESSION_DB_NAME, dir: "./", ttl: 86400 }),
    secret: process.env.SESSION_SECRET || "fallback-secret-please-set-env",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
  })
);

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error("❌ 無法連接到資料庫:", err.message);
  else console.log("✅ 已連接到 SQLite 資料庫");
});
db.run("PRAGMA busy_timeout = 5000"); // 遇到鎖定時最多等待 5 秒再回報錯誤，而不是立刻失敗

// 產生一組 promise 化的 db.all / db.get / db.run 輔助函式，給定一個連線物件
function makeDbHelpers(conn) {
  return {
    dbAll: (sql, params = []) =>
      new Promise((resolve, reject) =>
        conn.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
      ),
    dbGet: (sql, params = []) =>
      new Promise((resolve, reject) =>
        conn.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))
      ),
    dbExec: (sql, params = []) =>
      new Promise((resolve, reject) =>
        conn.run(sql, params, function (err) {
          if (err) reject(err);
          else resolve(this);
        })
      ),
  };
}

// ── 點名資料表遷移 ─────────────────────────────
// 1) 新增 created_at（實際送出時間，用來分辨當天點名與事後補點名）
// 2) 建立 (date, student_id) 唯一索引，資料庫層級防止同一學生同一天重複點名
// 若既有資料已有重複紀錄，索引會建立失敗；此時拒絕寫入點名，直到重複資料被清理
const { dbAll, dbGet, dbExec } = makeDbHelpers(db);

// 匯入名冊需要開 BEGIN/COMMIT/ROLLBACK 交易。SQLite 的交易狀態是綁在「連線」上，
// 不是綁在某個請求：若和其他 API 共用同一條連線，交易期間任何請求（哪怕邏輯上無關）
// 只要剛好在這段時間送出 SQL，都會被併入同一個交易，該交易失敗回滾時會連對方
// 已經回應成功的寫入也一起撤銷（已用獨立指令碼實測驗證過這個風險）。
// 因此匯入改用獨立連線，讓它的交易不會波及其他請求。
const importDb = new sqlite3.Database(DB_PATH);
importDb.run("PRAGMA busy_timeout = 5000");
const { dbExec: importExec } = makeDbHelpers(importDb);

let attendanceSchemaReady = null;
function ensureAttendanceSchema() {
  if (!attendanceSchemaReady) {
    attendanceSchemaReady = (async () => {
      const cols = await dbAll("PRAGMA table_info(attendance)");
      if (cols.length === 0) throw new Error("no such table: attendance");
      if (!cols.some((c) => c.name === "created_at"))
        await dbExec("ALTER TABLE attendance ADD COLUMN created_at TEXT");
      await dbExec(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_date_student ON attendance(date, student_id)"
      );
    })().catch((err) => {
      attendanceSchemaReady = null; // 下次請求重試（例如重複資料清理之後）
      throw err;
    });
  }
  return attendanceSchemaReady;
}
ensureAttendanceSchema().catch((err) => {
  if (!/no such table/i.test(err.message))
    console.warn("⚠️ 點名資料表遷移失敗（可能已有重複紀錄），點名寫入將被拒絕:", err.message);
});

// 新增 version 欄位：修改學生資料時用來做樂觀鎖（optimistic concurrency control），
// 避免兩位管理員同時編輯同一位學生時，後儲存的悄悄覆蓋掉先儲存的內容
let studentsSchemaReady = null;
function ensureStudentsSchema() {
  if (!studentsSchemaReady) {
    studentsSchemaReady = (async () => {
      const cols = await dbAll("PRAGMA table_info(students)");
      if (cols.length === 0) throw new Error("no such table: students");
      if (!cols.some((c) => c.name === "version")) {
        // DEFAULT 1：往後任何沒有明確指定 version 的 INSERT（包含既有測試／未來的程式碼）
        // 都會自動從 1 開始，不會變成 NULL
        await dbExec("ALTER TABLE students ADD COLUMN version INTEGER DEFAULT 1");
        await dbExec("UPDATE students SET version = 1 WHERE version IS NULL");
      }
    })().catch((err) => {
      studentsSchemaReady = null;
      throw err;
    });
  }
  return studentsSchemaReady;
}
ensureStudentsSchema().catch((err) => {
  if (!/no such table/i.test(err.message))
    console.warn("⚠️ 學生資料表遷移失敗，學生編輯／刪除將被拒絕:", err.message);
});

// 業務日期／時間：固定以 APP_TIMEZONE（預設台北）為準，不依賴各裝置系統時間或主機時區
const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Taipei";
const zonedFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIMEZONE,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hourCycle: "h23",
});
function zonedParts(date = new Date()) {
  const p = {};
  zonedFormatter.formatToParts(date).forEach((x) => { p[x.type] = x.value; });
  return p;
}
const serverToday = (date) => {
  const p = zonedParts(date);
  return `${p.year}-${p.month}-${p.day}`; // YYYY-MM-DD
};
const nowTimestamp = (date) => {
  const p = zonedParts(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
};
function isValidDate(str) {
  if (typeof str !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(`${str}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === str;
}
const VALID_STATUSES = ["在寢", "未歸", "晚歸"];

// req.query 的值理論上不保證是字串（例如 ?group[]=a 會被解析成陣列，?group[x]=1 會變成物件），
// 直接對它呼叫 .trim() 會拋出例外。統一正規化：不是字串就當成「沒帶這個參數」。
function asQueryString(v) {
  return typeof v === "string" ? v : undefined;
}

const users = [
  { username: "xm2801", password: process.env.PASSWORD_XM2801 || "admin", display_name: "德銘宿舍羅老師" },
  { username: "12130340", password: process.env.PASSWORD_YUCHENG || "Yucheng0803", display_name: "林煜晟（系統管理）" },
  { username: "deming", password: process.env.PASSWORD_DEMING || "1234", display_name: "宿舍各樓長" },
];

users.forEach((user) => {
  bcrypt.hash(user.password, BCRYPT_ROUNDS, (err, hash) => {
    if (!err) {
      db.run(
        `INSERT OR REPLACE INTO users (username, password, display_name) VALUES (?, ?, ?)`,
        [user.username, hash, user.display_name]
      );
    }
  });
});

const protectedPages = [
  "add_student.html",
  "history.html",
  "student_list.html",
  "change_password.html",
  "stats.html",
];

const requireLogin = (req, res, next) => {
  if (!req.session.user)
    return res.status(401).json({ success: false, message: "未登入" });

  const requestedPage = path.basename(req.path);
  if (
    req.session.user.username === "deming" &&
    protectedPages.includes(requestedPage)
  ) {
    return res.status(403).json({ success: false, message: "無權限訪問" });
  }
  next();
};

protectedPages.forEach((page) => {
  app.get(`/${page}`, requireLogin, (req, res) =>
    res.sendFile(path.join(__dirname, page))
  );
});

// 靜態檔案放在 protected routes 之後，確保受保護頁面需要驗證
app.use(express.static(__dirname));

// ================= API 區域 =================

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ success: false, message: "請輸入帳密" });

  db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
    if (err || !user)
      return res
        .status(401)
        .json({ success: false, message: "帳號或密碼錯誤" });
    bcrypt.compare(password, user.password, (err, result) => {
      if (result) {
        req.session.user = {
          username: user.username,
          display_name: user.display_name,
        };
        req.session.save(() =>
          res.json({ success: true, user: req.session.user })
        );
      } else {
        res.status(401).json({ success: false, message: "帳號或密碼錯誤" });
      }
    });
  });
});

app.get("/api/check-login", (req, res) =>
  res.json({ loggedIn: !!req.session.user, user: req.session.user })
);

app.get("/api/students/all", requireLogin, async (req, res) => {
  const group = asQueryString(req.query.group);
  if (!group) return res.status(400).json({ error: "缺少群組名稱" });
  try {
    await ensureStudentsSchema(); // 確保 version 欄位存在（樂觀鎖用）
    const rows = await dbAll(
      `SELECT id, name, roomNumber, COALESCE(phoneNumber, '無資料') AS phoneNumber, group_name, version FROM students WHERE TRIM(group_name) = ?`,
      [group.trim()]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "查詢失敗" });
  }
});

// 修改單一學生資料（姓名／房號／電話／群組；不可修改學號本身，
// 學號是主鍵，且沿用歷史點名紀錄的 student_id，改學號請刪除後重新新增）
app.patch("/api/students/:id", requireLogin, async (req, res) => {
  if (req.session.user.username === "deming")
    return res.status(403).json({ success: false, message: "無權限" });

  const { id } = req.params;
  const body = req.body || {};
  // 先確認每個欄位真的是字串再呼叫 .trim()：body 若帶數字/物件/陣列，
  // 直接 .trim() 會丟出同步例外，Express 4 的 async handler 接不住，
  // 會變成未處理的 Promise rejection（可能讓整個伺服器程序當掉）
  const isOptionalString = (v) => v === undefined || typeof v === "string";
  if (
    !isOptionalString(body.name) ||
    !isOptionalString(body.roomNumber) ||
    !isOptionalString(body.phoneNumber) ||
    !isOptionalString(body.group_name)
  ) {
    return res.status(400).json({ success: false, message: "欄位格式錯誤，須為文字" });
  }
  if (body.version !== undefined && !Number.isInteger(body.version)) {
    return res.status(400).json({ success: false, message: "version 格式錯誤" });
  }

  const name = (body.name || "").trim();
  const roomNumber = (body.roomNumber || "").trim();
  const groupName = (body.group_name || "").trim();
  const phoneNumber = (body.phoneNumber || "").trim() || "無資料";
  const expectedVersion = body.version; // 樂觀鎖：前端讀取當下的 version，一併送回來比對

  if (!name || !roomNumber || !groupName)
    return res.status(400).json({ success: false, message: "姓名、房號、群組不可為空" });

  try {
    await ensureStudentsSchema();

    // 直接以 UPDATE 的實際影響列數判斷結果，不另外先 SELECT 再 UPDATE：
    // 避免兩次查詢之間，資料被另一個請求改掉，卻仍誤報更新成功。
    // 有帶 version 時一併比對（樂觀鎖）：version 不符代表這期間被別人改過，
    // 回 409 而不是直接覆蓋，避免兩位管理員同時編輯時，後存的悄悄蓋掉先存的。
    const params = [name, roomNumber, phoneNumber, groupName, id];
    let sql = "UPDATE students SET name = ?, roomNumber = ?, phoneNumber = ?, group_name = ?, version = version + 1 WHERE id = ?";
    if (expectedVersion !== undefined) {
      sql += " AND version = ?";
      params.push(expectedVersion);
    }

    const result = await dbExec(sql, params);
    if (result.changes === 0) {
      // changes 為 0 有兩種可能：學生不存在，或 version 不符（被別人改過）；查一次分辨原因
      const existing = await dbGet("SELECT * FROM students WHERE id = ?", [id]);
      if (!existing) return res.status(404).json({ success: false, message: "找不到此學生" });
      return res.status(409).json({
        success: false,
        message: "這位學生的資料已被其他人更新，請重新整理後再試",
        current: existing,
      });
    }
    // 回傳更新後的 version，讓前端可以記住最新版本，供下一次編輯同一列時使用
    const updated = await dbGet("SELECT version FROM students WHERE id = ?", [id]);
    res.json({ success: true, message: "已更新學生資料", version: updated ? updated.version : undefined });
  } catch (err) {
    console.error("❌ 更新學生資料失敗:", err.message);
    res.status(500).json({ success: false, message: "資料庫錯誤" });
  }
});

// 刪除單一學生（僅從名冊移除；不影響此學生既有的歷史點名紀錄）
app.delete("/api/students/:id", requireLogin, async (req, res) => {
  if (req.session.user.username === "deming")
    return res.status(403).json({ success: false, message: "無權限" });

  try {
    const result = await dbExec("DELETE FROM students WHERE id = ?", [req.params.id]);
    if (result.changes === 0)
      return res.status(404).json({ success: false, message: "找不到此學生" });
    res.json({ success: true, message: "已刪除學生資料" });
  } catch (err) {
    console.error("❌ 刪除學生失敗:", err.message);
    res.status(500).json({ success: false, message: "資料庫錯誤" });
  }
});

// 伺服器認定的今天（前端用來限制補點名日期上限）
app.get("/api/server-date", requireLogin, (req, res) => res.json({ date: serverToday() }));

app.get("/api/groups", requireLogin, (req, res) => {
  db.all(
    "SELECT DISTINCT TRIM(group_name) as group_name FROM students WHERE group_name IS NOT NULL ORDER BY group_name ASC",
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows.map((row) => row.group_name));
    }
  );
});

// ==========================================
// 🔍 新增：搜尋單一學生 API (包含今日狀態)
// ==========================================
app.get("/api/student/search", requireLogin, async (req, res) => {
  const id = asQueryString(req.query.id);
  if (!id)
    return res.status(400).json({ success: false, message: "請輸入學號" });

  // 取得今日日期 (YYYY-MM-DD)，這裡使用 ISO 格式取日期部分
  const today = serverToday();

  const sql = `
    SELECT s.id, s.name, s.roomNumber, s.phoneNumber, s.group_name, s.version, a.status as today_status
    FROM students s
    LEFT JOIN attendance a ON s.id = a.student_id AND a.date = ?
    WHERE s.id = ?
  `;

  try {
    await ensureStudentsSchema(); // 確保 version 欄位存在（樂觀鎖用）
    const row = await dbGet(sql, [today, id]);
    if (!row)
      return res.status(404).json({ success: false, message: "找不到此學號" });
    res.json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ success: false, message: "資料庫錯誤" });
  }
});
// ==========================================

app.get("/api/attendance/history", requireLogin, (req, res) => {
  const date = asQueryString(req.query.date);
  const group = asQueryString(req.query.group);
  const page     = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(10000, Math.max(10, parseInt(req.query.pageSize) || 50));
  const offset   = (page - 1) * pageSize;

  const baseFrom = `FROM attendance LEFT JOIN students ON attendance.student_id = students.id WHERE 1=1`;
  const params = [];
  let where = "";

  if (date)  { where += " AND attendance.date = ?";           params.push(date); }
  if (group) { where += " AND TRIM(students.group_name) = ?"; params.push(group.trim()); }

  // 房號用 attendance 當時存的快照（attendance.roomNumber），不是 students 目前的房號：
  // 這樣學生之後搬房、被移出名冊，過去的歷史紀錄仍顯示「點名當下」的正確房號，
  // 不會變成 N/A 或被之後的搬房覆蓋掉。group 篩選仍用「目前」名冊的群組（見上方 WHERE）。
  const orderBy = " ORDER BY attendance.roomNumber ASC, attendance.studentName ASC";
  const selectFields = `SELECT attendance.date, attendance.student_id, attendance.studentName, attendance.status, attendance.roomNumber `;

  // 1. 取得總筆數
  db.get(`SELECT COUNT(*) as total ${baseFrom}${where}`, params, (err, countRow) => {
    if (err) return res.status(500).json({ success: false, message: "查詢失敗" });

    const total      = countRow.total;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    // 2. 取得各狀態統計（不受分頁影響）
    db.all(
      `SELECT status, COUNT(*) as count ${baseFrom}${where} GROUP BY status`,
      params,
      (err, summaryRows) => {
        const summary = { 在寢: 0, 未歸: 0, 晚歸: 0 };
        if (!err && summaryRows) {
          summaryRows.forEach(r => { if (r.status in summary) summary[r.status] = r.count; });
        }

        // 3. 取得分頁資料
        db.all(
          `${selectFields}${baseFrom}${where}${orderBy} LIMIT ? OFFSET ?`,
          [...params, pageSize, offset],
          (err, records) => {
            if (err) return res.status(500).json({ success: false, message: "查詢失敗" });
            res.json({ success: true, data: records || [], total, page, totalPages, summary });
          }
        );
      }
    );
  });
});

app.get("/api/attendance/dates", requireLogin, (req, res) => {
  db.all(
    `SELECT DISTINCT date FROM attendance ORDER BY date DESC`,
    [],
    (err, rows) => {
      if (err)
        return res.status(500).json({ success: false, message: "查詢失敗" });
      res.json(rows.map((row) => row.date));
    }
  );
});

app.post("/api/attendance/submit", requireLogin, async (req, res) => {
  const { date, group, attendanceData } = req.body;
  if (!date || !group || !attendanceData)
    return res.status(400).json({ error: "資料不完整" });

  // ── 輸入驗證 ──
  if (!isValidDate(date))
    return res.status(400).json({ error: "日期格式錯誤，須為有效的 YYYY-MM-DD" });
  if (date > serverToday())
    return res.status(400).json({ error: "不可對未來日期點名" });
  if (typeof group !== "string" || !group.trim())
    return res.status(400).json({ error: "群組名稱錯誤" });
  if (!Array.isArray(attendanceData) || attendanceData.length === 0)
    return res.status(400).json({ error: "沒有學生資料可提交" });
  for (const s of attendanceData) {
    if (!s || typeof s.student_id !== "string" || !s.student_id)
      return res.status(400).json({ error: "學號資料錯誤" });
    if (!VALID_STATUSES.includes(s.status))
      return res.status(400).json({ error: "點名狀態錯誤" });
  }
  const studentIds = attendanceData.map((s) => s.student_id);
  if (new Set(studentIds).size !== studentIds.length)
    return res.status(400).json({ error: "同一學生重複出現在點名資料中" });

  try {
    await ensureAttendanceSchema();
  } catch (err) {
    console.error("❌ 點名資料表未就緒:", err.message);
    return res.status(500).json({ error: "資料庫存在重複點名紀錄，請先清理後再點名" });
  }

  try {
    // 學生必須存在且屬於此群組（同時取得房號）
    const placeholders = studentIds.map(() => "?").join(",");
    const studentRows = await dbAll(
      `SELECT id, name, roomNumber FROM students WHERE id IN (${placeholders}) AND TRIM(group_name) = ?`,
      [...studentIds, group.trim()]
    );
    if (studentRows.length !== studentIds.length)
      return res.status(400).json({ error: "部分學生不存在或不屬於此群組" });
    const studentMap = {};
    studentRows.forEach((r) => { studentMap[r.id] = r; });

    // 已點名者略過（部分點名的群組仍可補點其餘學生）
    const markedRows = await dbAll(
      `SELECT student_id FROM attendance WHERE date = ? AND student_id IN (${placeholders})`,
      [date, ...studentIds]
    );
    const alreadyMarked = new Set(markedRows.map((r) => r.student_id));
    const newAttendance = attendanceData.filter((s) => !alreadyMarked.has(s.student_id));

    if (newAttendance.length === 0)
      return res.status(409).json({ success: false, error: "所選學生在該日期均已點名，請勿重複點名", date, inserted: 0 });

    // 單一 SQL 敘述一次寫入（不可分割）。同時送出的請求若已被搶先寫入，
    // ON CONFLICT DO NOTHING 會略過該列，再以 this.changes 得知實際寫入筆數。
    const valuesSql = newAttendance
      .map(() => "(?, ?, ?, ?, ?, ?)")
      .join(",");
    const params = [];
    const createdAt = nowTimestamp();
    newAttendance.forEach((s) => {
      const st = studentMap[s.student_id];
      params.push(date, s.student_id, st.name, s.status, st.roomNumber, createdAt);
    });
    const result = await dbExec(
      `INSERT INTO attendance (date, student_id, studentName, status, roomNumber, created_at)
       VALUES ${valuesSql}
       ON CONFLICT(date, student_id) DO NOTHING`,
      params
    );

    if (result.changes === 0)
      return res.status(409).json({ success: false, error: "所選學生在該日期均已點名，請勿重複點名", date, inserted: 0 });

    res.json({
      success: true,
      message: "點名成功",
      inserted: result.changes,
      skipped: studentIds.length - result.changes,
    });
  } catch (err) {
    console.error("❌ 點名寫入失敗:", err.message);
    res.status(500).json({ error: "寫入失敗" });
  }
});

// **🆕 新增：清除所有點名紀錄 API (只有管理員可執行)**
app.delete("/api/attendance/clear", requireLogin, (req, res) => {
  // 安全檢查：只有管理員 (12130340 或 xm2801) 可以刪除，deming (樓長) 不行
  if (req.session.user.username === "deming") {
    return res
      .status(403)
      .json({ success: false, message: "您沒有權限執行此操作" });
  }

  db.run("DELETE FROM attendance", (err) => {
    if (err) {
      console.error("❌ 清除資料失敗:", err);
      return res
        .status(500)
        .json({ success: false, message: "資料庫錯誤，清除失敗" });
    }

    // 選用：重置自增 ID (讓下次點名從 ID 1 開始)
    db.run("DELETE FROM sqlite_sequence WHERE name='attendance'", (seqErr) => {
      if (seqErr) console.warn("⚠️ 無法重置 ID 序列:", seqErr);
    });

    console.log(
      `⚠️ 使用者 ${req.session.user.display_name} 已清空所有點名紀錄`
    );
    res.json({ success: true, message: "所有歷史紀錄已成功清除！" });
  });
});

// **修正後的匯入 API (對應您的 Excel 實際欄位)**
let importInProgress = false; // 同一時間只允許一份名冊在匯入（importDb 是單一連線，兩個匯入同時進行仍會互相干擾）

app.post(
  "/api/students/import",
  requireLogin,
  upload.single("file"),
  async (req, res) => {
    if (req.session.user.username === "deming")
      return res.status(403).json({ success: false, message: "無權限" });
    if (!req.file)
      return res.status(400).json({ success: false, message: "未上傳檔案" });
    if (importInProgress)
      return res.status(409).json({ success: false, message: "另一份名冊正在匯入中，請稍候再試" });

    try {
      const workbook = new ExcelJS.Workbook();
      const originalName = req.file.originalname.toLowerCase();
      let worksheet;

      console.log(
        `📂 收到檔案: ${req.file.originalname} (${req.file.mimetype})`
      );

      // 自動判斷格式
      if (originalName.endsWith(".csv") || req.file.mimetype === "text/csv") {
        console.log("🔄 偵測為 CSV 模式讀取...");
        const bufferStream = new stream.PassThrough();
        bufferStream.end(req.file.buffer);
        await workbook.csv.read(bufferStream);
        worksheet = workbook.getWorksheet(1);
      } else {
        console.log("🔄 偵測為 Excel (XLSX) 模式讀取...");
        await workbook.xlsx.load(req.file.buffer);
        worksheet = workbook.getWorksheet(1);
      }

      if (!worksheet)
        return res
          .status(400)
          .json({ success: false, message: "無法讀取檔案內容" });

      let headers = {};
      // 讀取標題
      worksheet.getRow(1).eachCell((cell, colNumber) => {
        const val = cell.value
          ? cell.value
              .toString()
              .trim()
              .replace(/^\ufeff/, "")
          : "";
        headers[val] = colNumber;
      });

      console.log("📋 偵測到的欄位:", JSON.stringify(headers));

      // **📝 關鍵修正：這裡改成您 Excel 裡實際的標題名稱**
      const requiredFields = ["性別", "學號", "姓名", "房號", "床"]; // 注意：這裡是「床」，不是「床號」
      const missing = requiredFields.filter((f) => !headers[f]);

      if (missing.length > 0) {
        return res
          .status(400)
          .json({ success: false, message: `缺少欄位: ${missing.join(", ")}` });
      }

      // ExcelJS 對不同儲存格型別回傳不同形狀的 value，統一轉成純文字：
      // - 富文字（richText）：把每個片段的文字接起來
      // - 公式（formula）：優先取試算表軟體已經算好、存起來的 result；公式算出錯誤（error）視為空白
      // - 超連結等 {text, hyperlink}：取 text
      // - 日期：轉成 YYYY-MM-DD，避免變成完整的 ISO 時間字串
      // - 數字 0：以前的寫法用 `val ? ... : ""` 會把合法的 0 誤判成空值，這裡改成明確檢查 null/undefined
      function cellToText(val) {
        if (val === null || val === undefined) return "";
        if (val instanceof Date) return val.toISOString().slice(0, 10);
        if (typeof val === "object") {
          if (Array.isArray(val.richText)) return val.richText.map((r) => r.text || "").join("");
          if ("error" in val) return "";
          if ("result" in val) return cellToText(val.result);
          if ("text" in val) return String(val.text);
          return ""; // 其他未知物件型別，安全起見視為空白，而不是變成 "[object Object]"
        }
        return String(val);
      }

      // 性別欄位常見的打字變體，正規化成「男」／「女」；無法辨識的一律跳過，
      // 避免產生沒有性別前綴的畸形群組（例如「德明宿舍 3樓」）
      const normalizeGender = (raw) => {
        const g = raw.trim();
        if (["男", "男生", "M", "m"].includes(g)) return "男";
        if (["女", "女生", "F", "f"].includes(g)) return "女";
        return null;
      };

      const students = [];
      const seenIds = new Set();
      const skipped = []; // { row, id, name, reason }
      const addSkip = (rowNumber, id, name, reason) => {
        skipped.push({ row: rowNumber, id: id || "(無學號)", name: name || "(無姓名)", reason });
      };

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // 跳過標題
        // 略過完全空白的列（常見於 Excel 結尾的空列），不當成錯誤回報
        if (row.cellCount === 0 || row.values.every((v) => v == null || v === "")) return;

        const getVal = (key) => {
          const idx = headers[key];
          if (!idx) return "";
          return cellToText(row.getCell(idx).value).trim();
        };

        const genderRaw = getVal("性別");
        const id = getVal("學號");
        const name = getVal("姓名");
        const room = getVal("房號");
        const bed = getVal("床"); // 對應 Excel 的「床」
        const phone = getVal("電話") || getVal("手機號碼") || "無資料";

        const missingFields = [];
        if (!id) missingFields.push("學號");
        if (!name) missingFields.push("姓名");
        if (!room) missingFields.push("房號");
        if (!bed) missingFields.push("床");
        if (!genderRaw) missingFields.push("性別");
        if (missingFields.length > 0) {
          addSkip(rowNumber, id, name, `缺少欄位: ${missingFields.join("、")}`);
          return;
        }

        const gender = normalizeGender(genderRaw);
        if (!gender) {
          addSkip(rowNumber, id, name, `性別欄位「${genderRaw}」無法辨識，須為「男」或「女」`);
          return;
        }

        if (seenIds.has(id)) {
          addSkip(rowNumber, id, name, "學號重複，已略過此列");
          return;
        }
        seenIds.add(id);

        // 房號 + 床 (1231 + B => 1231B)，並依房號尾數自動分組
        const formattedRoom = `${room}${bed}`;
        const floor = room.slice(-1);
        const groupName = `德明宿舍${gender} ${floor}樓`;

        students.push({
          id,
          name,
          roomNumber: formattedRoom,
          phoneNumber: phone,
          group_name: groupName,
        });
      });

      if (students.length === 0) {
        return res.status(400).json({
          success: false,
          message: skipped.length > 0 ? "所有資料列均無法匯入，請檢查欄位內容" : "無有效資料",
          skipped: skipped.slice(0, 200),
          skippedCount: skipped.length,
          skippedTruncated: skipped.length > 200,
        });
      }

      try {
        await ensureStudentsSchema();
      } catch (err) {
        console.error("❌ 學生資料表未就緒:", err.message);
        return res.status(500).json({ success: false, message: "資料庫尚未就緒，請稍後再試" });
      }

      importInProgress = true;
      try {
        await importExec("BEGIN TRANSACTION");
        try {
          await importExec("DELETE FROM students"); // 清除所有舊資料，確保完整替換
          for (const s of students) {
            await importExec(
              `INSERT INTO students (id, name, roomNumber, phoneNumber, group_name, version) VALUES (?, ?, ?, ?, ?, 1)`,
              [s.id, s.name, s.roomNumber, s.phoneNumber, s.group_name]
            );
          }
          await importExec("COMMIT");
        } catch (dbErr) {
          console.error("❌ 匯入寫入失敗，已回滾:", dbErr.message);
          await importExec("ROLLBACK").catch(() => {});
          return res.status(500).json({ success: false, message: "資料庫寫入失敗，名冊未被更動" });
        }
      } finally {
        importInProgress = false;
      }

      const skippedCount = skipped.length;
      console.log(
        `✅ 成功匯入 ${students.length} 筆資料（已取代舊名冊）${skippedCount ? `，略過 ${skippedCount} 筆` : ""}`
      );
      res.json({
        success: true,
        message:
          `成功匯入 ${students.length} 筆學生資料，舊名冊已完整取代！` +
          (skippedCount > 0 ? ` 另有 ${skippedCount} 筆資料因欄位問題被略過，請檢查後手動補登。` : ""),
        imported: students.length,
        skipped: skipped.slice(0, 200),
        skippedCount: skipped.length,
        skippedTruncated: skipped.length > 200,
      });
    } catch (error) {
      console.error("處理錯誤:", error);
      res
        .status(500)
        .json({ success: false, message: "檔案解析錯誤，請確認格式。" });
    }
  }
);

// 檢查某日某群組的點名狀態（date 省略時以伺服器今天為準）
// completed：全員都已點名；marked_ids：已點名的學號（部分點名時前端只列出尚未點名者）
app.get("/api/attendance/check", requireLogin, async (req, res) => {
  const group = asQueryString(req.query.group);
  const date = req.query.date || serverToday();
  if (!group) return res.status(400).json({ error: "缺少參數" });
  if (!isValidDate(date)) return res.status(400).json({ error: "日期格式錯誤" });
  if (date > serverToday()) return res.status(400).json({ error: "不可對未來日期點名" });

  try {
    // 單一查詢同時取得名冊與點名狀態，確保 total 與 marked 來自同一份快照
    const rows = await dbAll(
      `SELECT s.id, EXISTS(
         SELECT 1 FROM attendance a WHERE a.student_id = s.id AND a.date = ?
       ) AS is_marked
       FROM students s WHERE TRIM(s.group_name) = ?`,
      [date, group.trim()]
    );
    const markedIds = rows.filter((r) => r.is_marked).map((r) => r.id);
    const total = rows.length;
    const marked = markedIds.length;
    res.json({
      date,
      exists: marked > 0,
      count: marked,
      total,
      marked,
      completed: total > 0 && marked >= total,
      marked_ids: markedIds,
    });
  } catch (err) {
    res.status(500).json({ error: "查詢失敗" });
  }
});

// 查詢單一學生的歷史點名紀錄（最近 30 天）
app.get("/api/student/history", requireLogin, (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ success: false, message: "請輸入學號" });

  db.all(
    `SELECT date, status FROM attendance WHERE student_id = ? ORDER BY date DESC LIMIT 30`,
    [id],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: "資料庫錯誤" });
      res.json({ success: true, data: rows });
    }
  );
});

// 修改單筆點名狀態
app.patch("/api/attendance/update", requireLogin, (req, res) => {
  const { student_id, date, status } = req.body;
  if (!student_id || !date || !status)
    return res.status(400).json({ error: "資料不完整" });

  db.run(
    "UPDATE attendance SET status = ? WHERE student_id = ? AND date = ?",
    [status, student_id, date],
    function (err) {
      if (err) return res.status(500).json({ error: "更新失敗" });
      if (this.changes === 0) return res.status(404).json({ error: "找不到紀錄" });
      res.json({ success: true, message: "已更新狀態" });
    }
  );
});

// 刪除單筆點名紀錄
app.delete("/api/attendance/delete", requireLogin, (req, res) => {
  if (req.session.user.username === "deming")
    return res.status(403).json({ error: "無權限" });

  const { student_id, date } = req.query;
  if (!student_id || !date)
    return res.status(400).json({ error: "資料不完整" });

  db.run(
    "DELETE FROM attendance WHERE student_id = ? AND date = ?",
    [student_id, date],
    function (err) {
      if (err) return res.status(500).json({ error: "刪除失敗" });
      if (this.changes === 0) return res.status(404).json({ error: "找不到紀錄" });
      res.json({ success: true, message: "已刪除紀錄" });
    }
  );
});

// RFC 8187：encodeURIComponent 不會編碼 ' ( ) *，但它們不在 attr-char 允許集合內，需另外百分比編碼
const encodeRfc5987 = (str) =>
  encodeURIComponent(str).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

// CSV 欄位：一律加雙引號並跳脫內含的雙引號；以 = + - @、換行、Tab 及全形公式符號開頭的文字前綴 ' 避免被試算表當成公式
function csvCell(value) {
  let str = value == null ? "" : String(value);
  if (/^[=+\-@\t\r\n＝＋－＠]/.test(str)) str = "'" + str;
  return `"${str.replace(/"/g, '""')}"`;
}

// 匯出（Excel / CSV）：date 可省略，省略時匯出全部日期；不分頁，一次匯出所有符合條件的紀錄
// format=csv 匯出 CSV，其餘為 Excel
app.get("/api/attendance/export", requireLogin, (req, res) => {
  const date = asQueryString(req.query.date);
  const group = asQueryString(req.query.group);
  const format = req.query.format === "csv" ? "csv" : "xlsx";
  if (date && !isValidDate(date)) return res.status(400).json({ error: "日期格式錯誤" });

  // 房號用 attendance 當時存的快照（a.roomNumber），不是 students 目前的房號，理由同歷史查詢 API
  let query = `SELECT a.date, a.student_id, a.studentName, a.status, a.roomNumber
               FROM attendance a LEFT JOIN students s ON a.student_id = s.id
               WHERE 1=1`;
  const params = [];
  if (date)  { query += " AND a.date = ?";                params.push(date); }
  if (group) { query += " AND TRIM(s.group_name) = ?";    params.push(group.trim()); }
  query += " ORDER BY a.date ASC, a.roomNumber ASC, a.studentName ASC";

  db.all(query, params, async (err, records) => {
    if (err) return res.status(500).json({ error: "查詢失敗" });
    try {
      if (records.length === 0) return res.status(404).json({ error: "無可匯出的歷史紀錄" });

      // 檔名含群組（中文）時需用 RFC 5987 的 filename*，HTTP header 不能直接放非 ASCII
      const asciiName = `attendance_${date || "all_" + serverToday()}.${format}`;
      const fullName = `attendance_${date || "all_" + serverToday()}${group ? "_" + group.trim() : ""}.${format}`;
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeRfc5987(fullName)}`
      );

      if (format === "csv") {
        const lines = ["日期,房號,學生姓名,狀態"];
        records.forEach((r) => {
          lines.push([r.date, r.roomNumber || "", r.studentName, r.status].map(csvCell).join(","));
        });
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        return res.send("\uFEFF" + lines.join("\r\n") + "\r\n");
      }

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("點名紀錄");

      sheet.columns = [
        { header: "日期", key: "date", width: 14 },
        { header: "房號", key: "roomNumber", width: 10 },
        { header: "學生姓名", key: "studentName", width: 14 },
        { header: "狀態", key: "status", width: 10 },
      ];

      // 標題列樣式
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

      records.forEach((r) => {
        const row = sheet.addRow({
          date: r.date,
          roomNumber: r.roomNumber || "N/A",
          studentName: r.studentName,
          status: r.status,
        });
        if (r.status === "未歸") {
          row.getCell("status").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF4C4C" } };
          row.getCell("status").font = { color: { argb: "FFFFFFFF" } };
        } else if (r.status === "晚歸") {
          row.getCell("status").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC000" } };
        }
      });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      await workbook.xlsx.write(res);
      res.end();
    } catch (e) {
      console.error("❌ 匯出失敗:", e);
      // 尚未開始傳送就回 500；已開始傳送則中止連線，避免請求懸置
      if (!res.headersSent) {
        res.removeHeader("Content-Disposition"); // 錯誤回應不能被當成檔案下載
        res.status(500).json({ error: "匯出失敗" });
      }
      else res.destroy();
    }
  });
});

// 修改密碼
app.post("/api/change-password", requireLogin, (req, res) => {
  if (req.session.user.username === "deming")
    return res.status(403).json({ success: false, message: "無權限" });

  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword)
    return res.status(400).json({ success: false, message: "資料不完整" });
  if (newPassword.length < 6)
    return res.status(400).json({ success: false, message: "新密碼至少需 6 個字元" });

  const username = req.session.user.username;
  db.get("SELECT password FROM users WHERE username = ?", [username], (err, user) => {
    if (err || !user) return res.status(500).json({ success: false, message: "查詢失敗" });

    bcrypt.compare(oldPassword, user.password, (err, match) => {
      if (!match) return res.status(401).json({ success: false, message: "舊密碼錯誤" });

      bcrypt.hash(newPassword, BCRYPT_ROUNDS, (err, hash) => {
        if (err) return res.status(500).json({ success: false, message: "加密失敗" });

        db.run("UPDATE users SET password = ? WHERE username = ?", [hash, username], (err) => {
          if (err) return res.status(500).json({ success: false, message: "更新失敗" });
          res.json({ success: true, message: "密碼已更新" });
        });
      });
    });
  });
});

// ================= 統計 API =================

// 今日各組點名完成狀況
app.get("/api/attendance/today-summary", requireLogin, (req, res) => {
  const today = serverToday();
  db.all(
    `SELECT
       TRIM(s.group_name) AS group_name,
       COUNT(DISTINCT s.id) AS total_students,
       COUNT(DISTINCT a.student_id) AS marked_count
     FROM students s
     LEFT JOIN attendance a ON s.id = a.student_id AND a.date = ?
     WHERE s.group_name IS NOT NULL
     GROUP BY TRIM(s.group_name)
     ORDER BY s.group_name ASC`,
    [today],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: "查詢失敗" });
      const data = (rows || []).map(r => ({
        group_name: r.group_name,
        total_students: r.total_students,
        marked_count: r.marked_count,
        completed: r.marked_count >= r.total_students && r.total_students > 0,
      }));
      res.json({ success: true, data });
    }
  );
});

// 統計概覽（今日/本月數字）
app.get("/api/stats/overview", requireLogin, (req, res) => {
  const today = serverToday();
  const monthPrefix = today.slice(0, 7); // e.g. "2025-09"

  const todayQuery = `SELECT status, COUNT(*) as count FROM attendance WHERE date = ? GROUP BY status`;
  const monthQuery = `SELECT status, COUNT(*) as count FROM attendance WHERE date LIKE ? GROUP BY status`;

  db.all(todayQuery, [today], (err, todayRows) => {
    if (err) return res.status(500).json({ success: false, message: "查詢失敗" });
    db.all(monthQuery, [monthPrefix + "%"], (err, monthRows) => {
      if (err) return res.status(500).json({ success: false, message: "查詢失敗" });

      const toMap = rows => {
        const m = { 在寢: 0, 未歸: 0, 晚歸: 0 };
        (rows || []).forEach(r => { if (r.status in m) m[r.status] = r.count; });
        return m;
      };

      res.json({
        success: true,
        today: toMap(todayRows),
        month: toMap(monthRows),
      });
    });
  });
});

// 最近 N 天出缺勤趨勢
app.get("/api/stats/trends", requireLogin, (req, res) => {
  const days = Math.min(90, Math.max(7, parseInt(req.query.days) || 30));
  db.all(
    `SELECT date, status, COUNT(*) as count
     FROM attendance
     WHERE date >= date(?, ?)
     GROUP BY date, status
     ORDER BY date ASC`,
    [serverToday(), `-${days} days`],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: "查詢失敗" });
      res.json({ success: true, data: rows || [] });
    }
  );
});

// 近 N 天未歸排行（Top 學生）
app.get("/api/stats/absentees", requireLogin, (req, res) => {
  const days = Math.min(90, Math.max(7, parseInt(req.query.days) || 30));
  const limit = Math.min(50, Math.max(5, parseInt(req.query.limit) || 10));
  db.all(
    `SELECT a.student_id, a.studentName, s.roomNumber, s.group_name,
            COUNT(*) AS absent_count
     FROM attendance a
     LEFT JOIN students s ON a.student_id = s.id
     WHERE a.status = '未歸' AND a.date >= date(?, ?)
     GROUP BY a.student_id
     ORDER BY absent_count DESC
     LIMIT ?`,
    [serverToday(), `-${days} days`, limit],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: "查詢失敗" });
      res.json({ success: true, data: rows || [] });
    }
  );
});

// ============================================

// 9. 登出
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

// 10. 根目錄
app.get("/", (req, res) =>
  res.redirect(req.session.user ? "/index.html" : "/login.html")
);

if (require.main === module) {
  app.listen(port, host, () =>
    console.log(`🚀 伺服器運行於 http://${host}:${port}`)
  );
}

module.exports = { app, db, importDb, serverToday };
