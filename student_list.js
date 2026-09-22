document.addEventListener("DOMContentLoaded", () => {
  const groupSelect = document.getElementById("groupSelect");
  const studentTableBody = document.getElementById("studentTableBody");
  const studentSearch = document.getElementById("studentSearch");

  // 記住目前是「搜尋模式」還是「群組模式」，供群組清單改變後判斷要不要重新整理
  let lastSearchId = null;
  // 目前正在編輯中的那一列，切換到編輯另一列或儲存/取消時，同步復原它（不重新整理整張表）
  let cancelCurrentEdit = null;

  loadGroupOptions();

  // 1. 取得學生群組列表（頁面載入、以及編輯／刪除可能改變群組後都會呼叫）
  function loadGroupOptions() {
    const previousValue = groupSelect.value;
    return fetch("/api/groups")
      .then((response) => response.json())
      .then((groups) => {
        groupSelect.innerHTML = "";
        if (groups.length === 0) {
          const opt = document.createElement("option");
          opt.value = "";
          opt.textContent = "無可用群組";
          groupSelect.appendChild(opt);
          return;
        }
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "請選擇";
        groupSelect.appendChild(placeholder);
        groups.forEach((group) => {
          const option = document.createElement("option");
          option.value = group;
          option.textContent = group;
          groupSelect.appendChild(option);
        });
        // 原本選的群組若還存在就保留選取狀態，避免每次都跳回「請選擇」
        if (groups.includes(previousValue)) groupSelect.value = previousValue;
      })
      .catch((error) => console.error("❌ 無法載入群組:", error));
  }

  // 2. 當選擇群組時，載入該群組的學生名單
  groupSelect.addEventListener("change", () => {
    lastSearchId = null;
    studentSearch.value = ""; // 清空搜尋框，避免混淆

    const group = groupSelect.value;
    if (!group) {
      showPlaceholder("請選擇群組以顯示學生");
      return;
    }
    loadGroupStudents(group);
  });

  function loadGroupStudents(group) {
    showPlaceholder("載入中...");
    fetch(`/api/students/all?group=${encodeURIComponent(group)}`)
      .then((response) => response.json())
      .then((students) => {
        console.log("📞 後端返回的學生數據:", students);
        if (!students || students.length === 0) {
          showPlaceholder("該群組無學生資料");
          return;
        }
        renderTable(students);
      })
      .catch((error) => {
        console.error("❌ 無法載入學生名單:", error);
        showPlaceholder("載入失敗");
      });
  }

  // 3. 學號搜尋功能
  studentSearch.addEventListener("keypress", (e) => {
    if (e.key !== "Enter") return;
    const id = studentSearch.value.trim();
    if (!id) return;

    groupSelect.value = ""; // 重置群組選單，表示現在是搜尋模式
    lastSearchId = id;
    searchStudent(id);
  });

  function searchStudent(id) {
    showPlaceholder("🔍 搜尋中...");
    fetch(`/api/student/search?id=${encodeURIComponent(id)}`)
      .then((response) => response.json())
      .then((result) => {
        if (result.success) {
          renderTable([result.data]);
        } else {
          showPlaceholder(`❌ 找不到學號為 ${id} 的學生`);
        }
      })
      .catch((error) => {
        console.error("搜尋錯誤:", error);
        showPlaceholder("搜尋發生錯誤");
      });
  }

  // 目前畫面是搜尋結果還是群組列表；只有刪除（該筆整個消失）需要重新查一次來確認清單，
  // 編輯則直接用回應資料更新該列即可，不需要整頁重新查詢
  function refreshCurrentView() {
    if (lastSearchId) searchStudent(lastSearchId);
    else if (groupSelect.value) loadGroupStudents(groupSelect.value);
  }

  function showPlaceholder(text) {
    cancelCurrentEdit = null; // 畫面即將整個清空重建，先前記錄的編輯列已不存在
    studentTableBody.innerHTML = "";
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = text;
    tr.appendChild(td);
    studentTableBody.appendChild(tr);
  }

  function renderTable(students) {
    cancelCurrentEdit = null;
    studentTableBody.innerHTML = "";
    const fragment = document.createDocumentFragment();
    students.forEach((student) => fragment.appendChild(buildRow(student)));
    studentTableBody.appendChild(fragment);
  }

  // 🛠 建立一列學生資料（含編輯／刪除按鈕）；一律用 textContent／DOM API 組裝，
  // 不使用 innerHTML 插入資料庫內容，避免姓名等欄位被當成 HTML 執行
  function buildRow(student) {
    const tr = document.createElement("tr");
    tr.dataset.id = student.id;

    const idTd = document.createElement("td");
    const nameTd = document.createElement("td");
    const roomTd = document.createElement("td");
    const phoneTd = document.createElement("td");
    const groupTd = document.createElement("td");
    const actionTd = document.createElement("td");
    actionTd.className = "action-cell";

    tr.append(idTd, nameTd, roomTd, phoneTd, groupTd, actionTd);

    const cells = { idTd, nameTd, roomTd, phoneTd, groupTd, actionTd };
    renderDisplayMode(tr, student, cells);
    return tr;
  }

  // 把一列畫回「顯示模式」（唯讀文字 + 編輯/刪除按鈕）。編輯完成或取消時都會呼叫，
  // 重複使用同一個 <tr>，不用重新整個表格，避免影響到其他正在編輯中的列
  function renderDisplayMode(tr, student, cells) {
    cells.idTd.textContent = student.id;
    cells.nameTd.textContent = student.name;
    cells.roomTd.textContent = student.roomNumber;
    cells.phoneTd.textContent = student.phoneNumber || "無資料";
    cells.groupTd.textContent = student.group_name || "—";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn-inline-save";
    editBtn.textContent = "編輯";

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn-inline-delete";
    deleteBtn.textContent = "刪除";

    cells.actionTd.replaceChildren(editBtn, deleteBtn);

    editBtn.addEventListener("click", () => enterEditMode(tr, student, cells));
    deleteBtn.addEventListener("click", () => deleteStudent(student, tr));
  }

  // 學號是主鍵、且沿用歷史點名紀錄，這裡不提供修改學號的欄位
  function enterEditMode(tr, student, cells) {
    // 一次只允許編輯一列：把另一列同步復原成顯示模式（不重新查詢，避免非同步時序把
    // 正要進入編輯的這一列一起洗掉）
    if (cancelCurrentEdit) cancelCurrentEdit();

    const makeInput = (value) => {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "inline-edit-input";
      input.value = value;
      return input;
    };

    const nameInput = makeInput(student.name);
    const roomInput = makeInput(student.roomNumber);
    const phoneInput = makeInput(student.phoneNumber === "無資料" ? "" : student.phoneNumber || "");
    const groupInput = makeInput(student.group_name || "");

    cells.nameTd.replaceChildren(nameInput);
    cells.roomTd.replaceChildren(roomInput);
    cells.phoneTd.replaceChildren(phoneInput);
    cells.groupTd.replaceChildren(groupInput);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn-inline-save";
    saveBtn.textContent = "儲存";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn-inline-cancel";
    cancelBtn.textContent = "取消";

    cells.actionTd.replaceChildren(saveBtn, cancelBtn);

    const cancel = () => {
      cancelCurrentEdit = null;
      renderDisplayMode(tr, student, cells);
    };
    cancelBtn.addEventListener("click", cancel);
    cancelCurrentEdit = cancel;

    saveBtn.addEventListener("click", () => {
      const payload = {
        name: nameInput.value.trim(),
        roomNumber: roomInput.value.trim(),
        phoneNumber: phoneInput.value.trim(),
        group_name: groupInput.value.trim(),
        version: student.version, // 樂觀鎖：帶上讀取畫面當下看到的版本，讓後端判斷有沒有被別人改過
      };
      if (!payload.name || !payload.roomNumber || !payload.group_name) {
        alert("⚠️ 姓名、房號、群組不可為空");
        return;
      }

      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      fetch(`/api/students/${encodeURIComponent(student.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then((res) => res.json().then((data) => ({ status: res.status, data })))
        .then(({ status, data }) => {
          if (status === 409) {
            // 被別人搶先改過了：不覆蓋，直接用伺服器目前最新的資料還原這一列，請使用者重新編輯
            alert("⚠️ " + data.message);
            cancelCurrentEdit = null;
            renderDisplayMode(tr, data.current || student, cells);
            return;
          }
          if (status !== 200 || !data.success) throw new Error(data.message || "更新失敗");
          cancelCurrentEdit = null;
          // 直接用剛剛送出的內容更新這一列，不必整頁重新查詢；version 用伺服器回傳的最新版本，
          // 下次編輯同一列時才不會拿到過期的版本號、把自己剛存的內容誤判成衝突
          const updated = { id: student.id, name: payload.name, roomNumber: payload.roomNumber,
            phoneNumber: payload.phoneNumber || "無資料", group_name: payload.group_name,
            version: data.version ?? student.version };
          renderDisplayMode(tr, updated, cells);
          // 只有群組真的改變時，才重新整理群組下拉選單（可能新增或消失一個群組）；
          // 若目前正以群組篩選查看，這位學生已被改到別的群組，重新查一次讓列表跟篩選條件一致
          if (payload.group_name !== student.group_name) {
            loadGroupOptions();
            if (groupSelect.value) refreshCurrentView();
          }
        })
        .catch((err) => {
          alert("❌ " + err.message);
          saveBtn.disabled = false;
          cancelBtn.disabled = false;
        });
    });
  }

  function deleteStudent(student, tr) {
    if (
      !confirm(
        `確定要刪除學生「${student.name}」（學號 ${student.id}）嗎？\n此操作僅將他從目前名冊移除，他過去的點名紀錄（含房號）仍會完整保留；但因為已不在名冊中，之後用群組篩選歷史紀錄時會找不到他，需選「全部群組」才看得到。`
      )
    )
      return;

    // 刪除按鈕只會出現在顯示模式（編輯中的列換成儲存／取消），
    // 所以這裡不可能刪到正在編輯中的那一列，不需要特別處理 cancelCurrentEdit
    fetch(`/api/students/${encodeURIComponent(student.id)}`, { method: "DELETE" })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok || !data.success) throw new Error(data.message || "刪除失敗");
        tr.remove();
        if (!studentTableBody.children.length) showPlaceholder("已無學生資料");
        loadGroupOptions(); // 這是該群組最後一人時，下拉選單要拿掉這個群組
      })
      .catch((err) => alert("❌ " + err.message));
  }
});
