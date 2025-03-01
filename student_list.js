document.addEventListener("DOMContentLoaded", () => {
  const groupSelect = document.getElementById("groupSelect");
  const studentTableBody = document.getElementById("studentTableBody");

  // 取得學生群組列表
  fetch("/api/groups")
    .then((response) => response.json())
    .then((groups) => {
      if (groups.length === 0) {
        groupSelect.innerHTML = "<option value=''>無可用群組</option>";
        return;
      }
      groups.forEach((group) => {
        let option = document.createElement("option");
        option.value = group;
        option.textContent = group;
        groupSelect.appendChild(option);
      });
    })
    .catch((error) => console.error("❌ 無法載入群組:", error));

  // 當選擇群組時，載入該群組的學生名單
  groupSelect.addEventListener("change", () => {
    const group = groupSelect.value;
    if (!group) {
      studentTableBody.innerHTML =
        "<tr><td colspan='4'>請選擇群組以顯示學生</td></tr>";
      return;
    }

    fetch(`/api/students/all?group=${encodeURIComponent(group)}`)
      .then((response) => response.json())
      .then((students) => {
        studentTableBody.innerHTML = ""; // 清空表格
        if (students.length === 0) {
          studentTableBody.innerHTML =
            "<tr><td colspan='4'>該群組無學生資料</td></tr>";
          return;
        }
        students.forEach((student) => {
          let row = `
            <tr>
              <td>${student.id}</td> <!-- 確保這裡有 id -->
              <td>${student.name}</td>
              <td>${student.roomNumber}</td>
              <td>${student.phoneNumber}</td>
            </tr>
          `;
          studentTableBody.innerHTML += row;
        });
      })
      .catch((error) => {
        console.error("❌ 無法載入學生名單:", error);
        studentTableBody.innerHTML =
          "<tr><td colspan='4'>載入失敗，請重試</td></tr>";
      });
  });
});
