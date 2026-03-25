document.addEventListener("DOMContentLoaded", function () {
  // 權限檢查：需登入且非樓長
  fetch("/api/check-login")
    .then((res) => res.json())
    .then((data) => {
      if (!data.loggedIn) {
        window.location.href = "login.html";
      } else if (data.user.username === "deming") {
        alert("無權限");
        window.location.href = "index.html";
      }
    })
    .catch(() => (window.location.href = "login.html"));

  const form = document.getElementById("change-password-form");
  const msg = document.getElementById("msg");
  const saveBtn = document.getElementById("save-btn");

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    const oldPassword = document.getElementById("old-password").value;
    const newPassword = document.getElementById("new-password").value;
    const confirmPassword = document.getElementById("confirm-password").value;

    if (newPassword !== confirmPassword) {
      showMsg("兩次輸入的新密碼不一致", false);
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "儲存中...";

    fetch("/api/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPassword, newPassword }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          showMsg("✅ 密碼已成功更新！", true);
          form.reset();
        } else {
          showMsg("❌ " + data.message, false);
        }
      })
      .catch(() => showMsg("❌ 無法連線伺服器", false))
      .finally(() => {
        saveBtn.disabled = false;
        saveBtn.textContent = "儲存變更";
      });
  });

  function showMsg(text, success) {
    msg.style.display = "block";
    msg.textContent = text;
    msg.style.background = success ? "#d4edda" : "#f8d7da";
    msg.style.color = success ? "#155724" : "#721c24";
    msg.style.border = `1px solid ${success ? "#c3e6cb" : "#f5c6cb"}`;
  }
});
