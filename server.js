require("dotenv").config();
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const path = require("path");
const cors = require("cors");
const ExcelJS = require("exceljs");

const app = express();
const port = process.env.PORT || 3000;

// 允許 CORS，讓不同網域能存取 API
app.use(cors());

// 連接到 SQLite 資料庫
const db = new sqlite3.Database("./dormitory.db", (err) => {
  if (err) {
    console.error("無法連接到資料庫", err.message);
  } else {
    console.log("已連接到 SQLite 資料庫");
    initDatabase();
  }
});

// 初始化資料庫表格
function initDatabase() {
  db.run(`CREATE TABLE IF NOT EXISTS students (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        roomNumber TEXT NOT NULL,
        phoneNumber TEXT NOT NULL,
        group_name TEXT NOT NULL
    )`);

  db.run(`CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        student_id TEXT NOT NULL,
        status TEXT NOT NULL,
        FOREIGN KEY (student_id) REFERENCES students (id)
    )`);

  console.log("資料庫表格已初始化");
}

// 中間件
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// 檢查資料庫連接的 API
app.get("/api/check-connection", (req, res) => {
  db.get("SELECT sqlite_version() as version", (err, row) => {
    if (err) {
      res.json({ connected: false, error: err.message });
    } else {
      res.json({ connected: true, version: row.version });
    }
  });
});

// 獲取學生列表的 API
app.get("/api/students", (req, res) => {
  const group = req.query.group;

  let sql =
    "SELECT id, name, roomNumber, phoneNumber, group_name FROM students";
  let params = [];

  if (group) {
    sql += " WHERE group_name = ?";
    params.push(group);
  }

  db.all(sql, params, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    res.json(rows);
  });
});

// 新增學生的 API（防止 SQL 注入）
app.post("/api/students", (req, res) => {
  const { id, name, roomNumber, phoneNumber, group } = req.body;

  if (!id || !name || !roomNumber || !phoneNumber || !group) {
    return res
      .status(400)
      .json({ success: false, message: "所有欄位都是必填的" });
  }

  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ success: false, message: "學號格式錯誤" });
  }

  const sql = `INSERT INTO students (id, name, roomNumber, phoneNumber, group_name) 
               VALUES (?, ?, ?, ?, ?)`;

  db.run(sql, [id, name, roomNumber, phoneNumber, group], function (err) {
    if (err) {
      if (err.message.includes("UNIQUE constraint failed")) {
        return res
          .status(400)
          .json({ success: false, message: "該學號已存在" });
      }
      return res.status(500).json({ success: false, message: err.message });
    }
    res.json({ success: true, id: this.lastID });
  });
});

// 提交點名記錄的 API（使用 SQL 事務避免部分寫入）
app.post("/api/attendance", (req, res) => {
  const { date, data } = req.body;

  if (!date || !data || !Array.isArray(data) || data.length === 0) {
    return res.status(400).json({ success: false, message: "無效的點名數據" });
  }

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    let errorOccurred = false;
    let insertCount = 0;

    data.forEach((record) => {
      if (errorOccurred) return;

      const sql = `INSERT INTO attendance (date, student_id, status) 
                   VALUES (?, ?, ?)`;

      db.run(sql, [date, record.studentId, record.status], function (err) {
        if (err) {
          errorOccurred = true;
          db.run("ROLLBACK");
          return res.status(500).json({ success: false, message: err.message });
        }

        insertCount++;
        if (insertCount === data.length) {
          db.run("COMMIT", (err) => {
            if (err) {
              return res
                .status(500)
                .json({ success: false, message: err.message });
            }
            res.json({ success: true, count: insertCount });
          });
        }
      });
    });
  });
});

// 匯出點名記錄為 Excel 的 API
app.get("/api/attendance/export", (req, res) => {
  const date = req.query.date;
  const group = req.query.group;

  if (!date) {
    return res.status(400).json({ error: "請提供日期參數" });
  }

  let sql = `
        SELECT a.date, s.roomNumber, s.name, a.status, s.group_name
        FROM attendance a
        JOIN students s ON a.student_id = s.id
        WHERE a.date = ?
    `;
  let params = [date];

  if (group) {
    sql += " AND s.group_name = ?";
    params.push(group);
  }

  sql += " ORDER BY s.group_name, s.roomNumber, s.name";

  db.all(sql, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("點名記錄");
    worksheet.columns = [
      { header: "日期", key: "date", width: 15 },
      { header: "房號", key: "roomNumber", width: 15 },
      { header: "姓名", key: "name", width: 15 },
      { header: "狀態", key: "status", width: 10 },
      { header: "群組", key: "group", width: 15 },
    ];

    rows.forEach((row) => worksheet.addRow(row));
    worksheet.getRow(1).font = { bold: true };

    let fileName = `點名記錄_${date}.xlsx`;
    if (group) {
      fileName = `點名記錄_${date}_${group}.xlsx`;
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(fileName)}"`
    );

    workbook.xlsx
      .write(res)
      .then(() => console.log("Excel 生成完成"))
      .catch((err) => {
        console.error("Excel 生成錯誤:", err);
        res.status(500).json({ error: err.message });
      });
  });
});

// 啟動伺服器
app.listen(port, () => {
  console.log(`伺服器運行於 http://localhost:${port}`);
});
