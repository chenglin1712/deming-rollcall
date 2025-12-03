require("dotenv").config();
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const path = require("path");
const cors = require("cors");
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
app.use(
  cors({
    origin: "*",
    methods: "GET,POST,OPTIONS",
    allowedHeaders: "Content-Type",
    credentials: true,
  })
);
app.use(bodyParser.json());
app.use(express.static(__dirname));

app.use(
  session({
    store: new SQLiteStore({ db: "sessions.db", dir: "./", ttl: 86400 }),
    secret: "secret_key",
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
  { username: "xm2801", password: "admin", display_name: "德銘宿舍羅老師" },
  {
    username: "12130340",
    password: "Yucheng0803",
    display_name: "林煜晟（系統管理）",
  },
  { username: "deming", password: "1234", display_name: "宿舍各樓長" },
];

users.forEach((user) => {
  bcrypt.hash(user.password, 10, (err, hash) => {
    if (!err) {
      db.run(
        `INSERT OR IGNORE INTO users (username, password, display_name) VALUES (?, ?, ?)`,
        [user.username, hash, user.display_name]
      );
    }
  });
});

const protectedPages = [
  "add_student.html",
  "history.html",
  "student_list.html",
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

app.get("/api/attendance/history", requireLogin, (req, res) => {
  const { date, group } = req.query;
  let query = `SELECT attendance.date, attendance.student_id, attendance.studentName, attendance.status, students.roomNumber FROM attendance LEFT JOIN students ON attendance.student_id = students.id WHERE 1=1`;
  const params = [];
  if (date) {
    query += " AND attendance.date = ?";
    params.push(date);
  }
  if (group) {
    query += " AND students.group_name = ?";
    params.push(group);
  }
  query += " ORDER BY students.roomNumber ASC, attendance.studentName ASC";

  db.all(query, params, (err, records) => {
    if (err)
      return res.status(500).json({ success: false, message: "查詢失敗" });
    res.json({ success: true, data: records || [] });
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

  db.serialize(() => {
    const studentIds = attendanceData.map((s) => s.student_id);
    db.all(
      `SELECT student_id FROM attendance WHERE date = ? AND student_id IN (${studentIds
        .map(() => "?")
        .join(",")})`,
      [date, ...studentIds],
      (err, rows) => {
        if (err) return res.status(500).json({ error: "查詢失敗" });

        const alreadyMarked = rows.map((r) => r.student_id);
        const newAttendance = attendanceData.filter(
          (s) => !alreadyMarked.includes(s.student_id)
        );

        if (newAttendance.length === 0)
          return res.status(409).json({ error: "所有學生均已點名" });

        const stmt = db.prepare(
          "INSERT INTO attendance (date, student_id, studentName, status, roomNumber) VALUES (?, ?, ?, ?, ?)"
        );
        let completed = 0;
        let errors = [];

        newAttendance.forEach((s) => {
          db.get(
            "SELECT roomNumber FROM students WHERE id = ?",
            [s.student_id],
            (err, row) => {
              let roomNum = row ? row.roomNumber : "N/A";
              if (!row) errors.push(s.student_id);
              stmt.run(date, s.student_id, s.studentName, s.status, roomNum);
              completed++;
              if (completed === newAttendance.length) {
                stmt.finalize();
                res.json({
                  success: true,
                  message:
                    errors.length > 0 ? "點名成功(部分無房號)" : "點名成功",
                });
              }
            }
          );
        });
      }
    );
  });
});

// **🆕 修正後的匯入 API (對應您的 Excel 實際欄位)**
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
