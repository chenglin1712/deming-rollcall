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

app.use(express.static(__dirname));

app.use(
  session({
    store: new SQLiteStore({ db: "sessions.db", dir: "./", ttl: 86400 }),
    secret: process.env.SESSION_SECRET || "fallback-secret-please-set-env",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
  })
);

const db = new sqlite3.Database("./dormitory.db", (err) => {
  if (err) console.error("❌ 無法連接到資料庫:", err.message);
  else console.log("✅ 已連接到 SQLite 資料庫");
});

const users = [
  { username: "xm2801", password: process.env.PASSWORD_XM2801 || "admin", display_name: "德銘宿舍羅老師" },
  { username: "12130340", password: process.env.PASSWORD_YUCHENG || "Yucheng0803", display_name: "林煜晟（系統管理）" },
  { username: "deming", password: process.env.PASSWORD_DEMING || "1234", display_name: "宿舍各樓長" },
];

users.forEach((user) => {
  bcrypt.hash(user.password, 10, (err, hash) => {
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

app.get("/api/students/all", requireLogin, (req, res) => {
  if (!req.query.group) return res.status(400).json({ error: "缺少群組名稱" });
  db.all(
    `SELECT id, name, roomNumber, COALESCE(phoneNumber, '無資料') AS phoneNumber FROM students WHERE TRIM(group_name) = ?`,
    [req.query.group.trim()],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "查詢失敗" });
      res.json(rows);
    }
  );
});

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
app.get("/api/student/search", requireLogin, (req, res) => {
  const { id } = req.query;
  if (!id)
    return res.status(400).json({ success: false, message: "請輸入學號" });

  // 取得今日日期 (YYYY-MM-DD)，這裡使用 ISO 格式取日期部分
  const today = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD，使用本地時區

  const sql = `
    SELECT s.id, s.name, s.roomNumber, s.phoneNumber, s.group_name, a.status as today_status
    FROM students s
    LEFT JOIN attendance a ON s.id = a.student_id AND a.date = ?
    WHERE s.id = ?
  `;

  db.get(sql, [today, id], (err, row) => {
    if (err)
      return res.status(500).json({ success: false, message: "資料庫錯誤" });
    if (!row)
      return res.status(404).json({ success: false, message: "找不到此學號" });

    res.json({ success: true, data: row });
  });
});
// ==========================================

app.get("/api/attendance/history", requireLogin, (req, res) => {
  const { date, group } = req.query;
  const page     = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(10000, Math.max(10, parseInt(req.query.pageSize) || 50));
  const offset   = (page - 1) * pageSize;

  const baseFrom = `FROM attendance LEFT JOIN students ON attendance.student_id = students.id WHERE 1=1`;
  const params = [];
  let where = "";

  if (date)  { where += " AND attendance.date = ?";           params.push(date); }
  if (group) { where += " AND TRIM(students.group_name) = ?"; params.push(group.trim()); }

  const orderBy = " ORDER BY students.roomNumber ASC, attendance.studentName ASC";
  const selectFields = `SELECT attendance.date, attendance.student_id, attendance.studentName, attendance.status, students.roomNumber `;

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

app.post("/api/attendance/submit", requireLogin, (req, res) => {
  const { date, group, attendanceData } = req.body;
  if (!date || !group || !attendanceData)
    return res.status(400).json({ error: "資料不完整" });

  const studentIds = attendanceData.map((s) => s.student_id);
  const placeholders = studentIds.map(() => "?").join(",");

  db.serialize(() => {
    db.all(
      `SELECT student_id FROM attendance WHERE date = ? AND student_id IN (${placeholders})`,
      [date, ...studentIds],
      (err, rows) => {
        if (err) return res.status(500).json({ error: "查詢失敗" });

        const alreadyMarked = new Set(rows.map((r) => r.student_id));
        const newAttendance = attendanceData.filter(
          (s) => !alreadyMarked.has(s.student_id)
        );

        if (newAttendance.length === 0)
          return res.status(409).json({ error: "所有學生均已點名" });

        const newIds = newAttendance.map((s) => s.student_id);
        const newPlaceholders = newIds.map(() => "?").join(",");

        // 一次查詢取得所有房號，避免巢狀非同步 race condition
        db.all(
          `SELECT id, roomNumber FROM students WHERE id IN (${newPlaceholders})`,
          newIds,
          (err, studentRows) => {
            if (err) return res.status(500).json({ error: "查詢失敗" });

            const roomMap = {};
            studentRows.forEach((r) => { roomMap[r.id] = r.roomNumber; });

            const stmt = db.prepare(
              "INSERT INTO attendance (date, student_id, studentName, status, roomNumber) VALUES (?, ?, ?, ?, ?)"
            );
            let hasErrors = false;

            newAttendance.forEach((s) => {
              const roomNum = roomMap[s.student_id] || "N/A";
              if (!roomMap[s.student_id]) hasErrors = true;
              stmt.run(date, s.student_id, s.studentName, s.status, roomNum);
            });

            stmt.finalize((err) => {
              if (err) return res.status(500).json({ error: "寫入失敗" });
              res.json({
                success: true,
                message: hasErrors ? "點名成功(部分無房號)" : "點名成功",
              });
            });
          }
        );
      }
    );
  });
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
app.post(
  "/api/students/import",
  requireLogin,
  upload.single("file"),
  async (req, res) => {
    if (req.session.user.username === "deming")
      return res.status(403).json({ success: false, message: "無權限" });
    if (!req.file)
      return res.status(400).json({ success: false, message: "未上傳檔案" });

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

      const students = [];
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // 跳過標題

        const getVal = (key) => {
          const idx = headers[key];
          if (!idx) return "";
          let val = row.getCell(idx).value;
          if (val && typeof val === "object" && val.text) val = val.text;
          return val ? val.toString().trim() : "";
        };

        const gender = getVal("性別");
        const id = getVal("學號");
        const name = getVal("姓名");
        const room = getVal("房號");
        const bed = getVal("床"); // **修正：對應 Excel 的「床」**
        const phone = getVal("電話") || getVal("手機號碼") || "無資料"; // **修正：優先抓「電話」**

        if (id && name && room && bed && gender) {
          // **邏輯 1：房號 + 床 (1231 + B => 1231B)**
          const formattedRoom = `${room}${bed}`;

          // **邏輯 2：自動分組**
          const floor = room.slice(-1);
          let groupPrefix = "德明宿舍";
          if (gender === "男") groupPrefix += "男";
          else if (gender === "女") groupPrefix += "女";

          const groupName = `${groupPrefix} ${floor}樓`;

          students.push({
            id,
            name,
            roomNumber: formattedRoom,
            phoneNumber: phone,
            group_name: groupName,
          });
        }
      });

      if (students.length === 0)
        return res.status(400).json({ success: false, message: "無有效資料" });

      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const stmt = db.prepare(
          `INSERT OR REPLACE INTO students (id, name, roomNumber, phoneNumber, group_name) VALUES (?, ?, ?, ?, ?)`
        );
        let count = 0;
        students.forEach((s) => {
          stmt.run(
            s.id,
            s.name,
            s.roomNumber,
            s.phoneNumber,
            s.group_name,
            (err) => {
              if (!err) count++;
            }
          );
        });
        stmt.finalize();
        db.run("COMMIT", (err) => {
          if (err)
            return res
              .status(500)
              .json({ success: false, message: "資料庫寫入失敗" });
          console.log(`✅ 成功匯入 ${count} 筆資料`);
          res.json({
            success: true,
            message: `成功匯入 ${count} 筆學生資料！`,
          });
        });
      });
    } catch (error) {
      console.error("處理錯誤:", error);
      res
        .status(500)
        .json({ success: false, message: "檔案解析錯誤，請確認格式。" });
    }
  }
);

// 檢查某日某群組是否已有點名紀錄
app.get("/api/attendance/check", requireLogin, (req, res) => {
  const { date, group } = req.query;
  if (!date || !group) return res.status(400).json({ error: "缺少參數" });

  db.get(
    `SELECT COUNT(*) as count FROM attendance a
     LEFT JOIN students s ON a.student_id = s.id
     WHERE a.date = ? AND TRIM(s.group_name) = ?`,
    [date, group.trim()],
    (err, row) => {
      if (err) return res.status(500).json({ error: "查詢失敗" });
      res.json({ exists: row.count > 0, count: row.count });
    }
  );
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

// 匯出 Excel
app.get("/api/attendance/export", requireLogin, (req, res) => {
  const { date, group } = req.query;
  if (!date) return res.status(400).json({ error: "請選擇日期" });

  let query = `SELECT a.date, a.student_id, a.studentName, a.status, s.roomNumber
               FROM attendance a LEFT JOIN students s ON a.student_id = s.id
               WHERE a.date = ?`;
  const params = [date];
  if (group) { query += " AND s.group_name = ?"; params.push(group); }
  query += " ORDER BY s.roomNumber ASC, a.studentName ASC";

  db.all(query, params, async (err, records) => {
    if (err) return res.status(500).json({ error: "查詢失敗" });

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
    res.setHeader("Content-Disposition", `attachment; filename="attendance_${date}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
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

      bcrypt.hash(newPassword, 10, (err, hash) => {
        if (err) return res.status(500).json({ success: false, message: "加密失敗" });

        db.run("UPDATE users SET password = ? WHERE username = ?", [hash, username], (err) => {
          if (err) return res.status(500).json({ success: false, message: "更新失敗" });
          res.json({ success: true, message: "密碼已更新" });
        });
      });
    });
  });
});

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

app.listen(port, host, () =>
  console.log(`🚀 伺服器運行於 http://${host}:${port}`)
);
