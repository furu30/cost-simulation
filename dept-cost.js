(function(app) {
  "use strict";

  function init() {
    document.getElementById("btn-add-dept").addEventListener("click", openAddModal);
    document.getElementById("btn-cancel-dept").addEventListener("click", closeModal);
    document.getElementById("dept-modal").addEventListener("click", function(e) {
      if (e.target === this) closeModal();
    });
    document.getElementById("form-dept").addEventListener("submit", function(e) {
      e.preventDefault();
      saveDept();
    });
    document.getElementById("dept-is-machine-based").addEventListener("change", toggleMachineFields);

    load();
    app.onTabSwitch("tab-dept", load);
  }

  function load() {
    var data = app.loadData();
    renderDeptCards(data.departments, data.companySettings);
    calcAndShowRates(data);
  }

  function renderDeptCards(depts, cs) {
    var container = document.getElementById("dept-container");
    if (!depts.length) {
      container.innerHTML = '<p class="text-muted text-center" style="padding:20px">部門が登録されていません。「+ 部門追加」ボタンで追加してください。</p>';
      return;
    }

    var level = cs.calc_level || 1;
    var allocType = cs.allocation_base_type || "worker_count";

    container.innerHTML = depts.map(function(d, idx) {
      var isMachine = d.is_machine_based;

      var html = '<div class="dept-card">';
      html += '<div class="dept-card-header">';
      html += '<h3>' + app.escHtml(d.department_name) + '</h3>';
      html += '<div>';
      html += '<button class="btn-icon" onclick="CostApp.deptCost.editDept(' + idx + ')" title="編集">&#9998;</button>';
      html += '<button class="btn-icon text-danger" onclick="CostApp.deptCost.removeDept(' + idx + ')" title="削除">&#10005;</button>';
      html += '</div>';
      html += '</div>';
      html += '<div class="dept-card-body">';
      html += '<span class="label">直接作業者数</span><span class="value">' + (d.worker_count || 0) + '名</span>';
      html += '<span class="label">年間人件費</span><span class="value">' + app.formatNum(d.annual_labor_cost || 0) + '円</span>';
      if (d.standard_machine_cost) {
        html += '<span class="label">機械装置費用</span><span class="value">' + app.formatNum(d.standard_machine_cost) + '円/年</span>';
      }
      if (allocType === "area") {
        html += '<span class="label">面積(㎡)</span><span class="value">' + (d.allocation_base_value || 0) + '</span>';
      } else if (allocType === "manual") {
        html += '<span class="label">配賦比率(%)</span><span class="value">' + (d.allocation_base_value || 0) + '</span>';
      }

      if (level >= 4 && isMachine) {
        html += '<span class="label">稼働形態</span><span class="value" style="color:var(--primary);font-weight:600">機械主体</span>';
        html += '<span class="label">設備台数</span><span class="value">' + (d.machine_count || 0) + '台</span>';
        html += '<span class="label">1台稼働時間</span><span class="value">' + app.formatNum(d.machine_operating_hours || 0) + 'h/年</span>';
      }

      html += '</div></div>';
      return html;
    }).join("");
  }

  function calcAndShowRates(data) {
    var cs = data.companySettings;
    var level = cs.calc_level || 1;
    var depts = data.departments;

    if (!depts.length) {
      document.getElementById("dept-rate-summary").style.display = "none";
      return;
    }

    var thead = document.getElementById("dept-rate-thead");
    var tbody = document.getElementById("dept-rate-tbody");

    if (level === 1) {
      // 方式1（簡易）: 総費用/稼働時間/統一レートのみ
      thead.innerHTML = '<tr><th>部門</th><th>総費用(円)</th><th>稼働時間(h)</th><th>レート(円/h)</th></tr>';
      var lv1 = app.calcEngine.calcLv1Rate(cs, depts);
      var deptResults = app.calcEngine.calcDeptRatesLv3(cs, depts, false);
      var rows = deptResults.map(function(r) {
        return '<tr class="text-muted">' +
          '<td>' + app.escHtml(r.dept.department_name) + '</td>' +
          '<td class="num">' + app.formatNum(Math.round(r.totalCost)) + '</td>' +
          '<td class="num">' + app.formatNum(Math.round(r.operatingHours)) + '</td>' +
          '<td class="num">' + app.formatNum(Math.round(r.hourlyRate)) + '</td>' +
        '</tr>';
      }).join("");
      rows += '<tr style="font-weight:700;border-top:2px solid var(--border-strong)">' +
        '<td>★ 全社統一</td>' +
        '<td class="num">' + app.formatNum(Math.round(lv1.totalDirectCost + lv1.totalIndirect)) + '</td>' +
        '<td class="num">' + app.formatNum(Math.round(lv1.totalHours)) + '</td>' +
        '<td class="num" style="color:var(--primary)">' + app.formatNum(Math.round(lv1.hourlyRate)) + '</td>' +
      '</tr>';
      tbody.innerHTML = rows;
    } else if (level === 2) {
      // 方式2: 全社統一（直接/間接分離）
      thead.innerHTML = '<tr><th>部門</th><th>直接原価(円)</th><th>間接費(円)</th><th>総費用(円)</th><th>稼働時間(h)</th><th>直接レート(円/h)</th><th>間接レート(円/h)</th><th>総レート(円/h)</th></tr>';
      var lv1 = app.calcEngine.calcLv1Rate(cs, depts);
      var deptResults = app.calcEngine.calcDeptRatesLv3(cs, depts, false);
      var rows = deptResults.map(function(r) {
        return '<tr class="text-muted">' +
          '<td>' + app.escHtml(r.dept.department_name) + '</td>' +
          '<td class="num">' + app.formatNum(Math.round(r.directCost)) + '</td>' +
          '<td class="num">' + app.formatNum(Math.round(r.allocatedIndirect)) + '</td>' +
          '<td class="num">' + app.formatNum(Math.round(r.totalCost)) + '</td>' +
          '<td class="num">' + app.formatNum(Math.round(r.operatingHours)) + '</td>' +
          '<td class="num">' + app.formatNum(Math.round(r.directHourlyRate)) + '</td>' +
          '<td class="num">' + app.formatNum(Math.round(r.indirectHourlyRate)) + '</td>' +
          '<td class="num">' + app.formatNum(Math.round(r.hourlyRate)) + '</td>' +
        '</tr>';
      }).join("");
      rows += '<tr style="font-weight:700;border-top:2px solid var(--border-strong)">' +
        '<td>★ 全社統一</td>' +
        '<td class="num">' + app.formatNum(Math.round(lv1.totalDirectCost)) + '</td>' +
        '<td class="num">' + app.formatNum(Math.round(lv1.totalIndirect)) + '</td>' +
        '<td class="num">' + app.formatNum(Math.round(lv1.totalDirectCost + lv1.totalIndirect)) + '</td>' +
        '<td class="num">' + app.formatNum(Math.round(lv1.totalHours)) + '</td>' +
        '<td class="num" style="color:var(--primary)">' + app.formatNum(Math.round(lv1.directHourlyRate)) + '</td>' +
        '<td class="num">' + app.formatNum(Math.round(lv1.indirectHourlyRate)) + '</td>' +
        '<td class="num">' + app.formatNum(Math.round(lv1.hourlyRate)) + '</td>' +
      '</tr>';
      tbody.innerHTML = rows;
    } else {
      // 方式3/4: 部門別レート（直接/間接分離）
      thead.innerHTML = '<tr><th>部門</th><th>直接原価(円)</th><th>間接費(円)</th><th>総費用(円)</th><th>稼働時間(h)</th><th>直接レート(円/h)</th><th>間接レート(円/h)</th><th>総レート(円/h)</th></tr>';
      var allowMachine = (level === 4);
      var results = app.calcEngine.calcDeptRatesLv3(cs, depts, allowMachine);
      tbody.innerHTML = results.map(function(r) {
        var machineTag = (level === 4 && r.dept.is_machine_based) ? ' <span class="text-muted" style="font-size:11px">⚙機械</span>' : '';
        return '<tr>' +
          '<td>' + app.escHtml(r.dept.department_name) + machineTag + '</td>' +
          '<td class="num">' + app.formatNum(Math.round(r.directCost)) + '</td>' +
          '<td class="num">' + app.formatNum(Math.round(r.allocatedIndirect)) + '</td>' +
          '<td class="num">' + app.formatNum(Math.round(r.totalCost)) + '</td>' +
          '<td class="num">' + app.formatNum(Math.round(r.operatingHours)) + '</td>' +
          '<td class="num" style="color:var(--primary);font-weight:600">' + app.formatNum(Math.round(r.directHourlyRate)) + '</td>' +
          '<td class="num">' + app.formatNum(Math.round(r.indirectHourlyRate)) + '</td>' +
          '<td class="num" style="font-weight:600">' + app.formatNum(Math.round(r.hourlyRate)) + '</td>' +
        '</tr>';
      }).join("");
    }

    document.getElementById("dept-rate-summary").style.display = "block";
  }

  // ── モーダル ──
  function openAddModal() {
    document.getElementById("dept-modal-title").textContent = "部門を追加";
    document.getElementById("dept-edit-idx").value = "";
    document.getElementById("dept-name").value = "";
    document.getElementById("dept-worker-count").value = 0;
    document.getElementById("dept-annual-labor-cost").value = 0;
    document.getElementById("dept-alloc-value").value = 0;
    document.getElementById("dept-is-machine-based").value = "false";
    document.getElementById("dept-machine-cost").value = 0;
    document.getElementById("dept-machine-count").value = 0;
    document.getElementById("dept-machine-hours").value = 0;
    toggleMachineFields();
    toggleAllocValueField();
    document.getElementById("dept-modal").style.display = "grid";
  }

  function editDept(idx) {
    var data = app.loadData();
    var d = data.departments[idx];
    if (!d) return;

    document.getElementById("dept-modal-title").textContent = "部門を編集";
    document.getElementById("dept-edit-idx").value = idx;
    document.getElementById("dept-name").value = d.department_name || "";
    document.getElementById("dept-worker-count").value = d.worker_count || 0;
    document.getElementById("dept-annual-labor-cost").value = d.annual_labor_cost || 0;
    document.getElementById("dept-alloc-value").value = d.allocation_base_value || 0;
    document.getElementById("dept-is-machine-based").value = d.is_machine_based ? "true" : "false";
    document.getElementById("dept-machine-cost").value = d.standard_machine_cost || 0;
    document.getElementById("dept-machine-count").value = d.machine_count || 0;
    document.getElementById("dept-machine-hours").value = d.machine_operating_hours || 0;
    toggleMachineFields();
    toggleAllocValueField();
    document.getElementById("dept-modal").style.display = "grid";
  }

  function closeModal() {
    document.getElementById("dept-modal").style.display = "none";
  }

  function toggleMachineFields() {
    var isMachine = document.getElementById("dept-is-machine-based").value === "true";
    document.getElementById("machine-detail-fields").style.display = isMachine ? "block" : "none";
  }

  function toggleAllocValueField() {
    var data = app.loadData();
    var allocType = data.companySettings.allocation_base_type || "worker_count";
    var section = document.getElementById("alloc-value-section");
    var label = document.getElementById("alloc-value-label");
    if (allocType === "area") {
      section.style.display = "block";
      label.textContent = "面積(㎡)";
    } else if (allocType === "manual") {
      section.style.display = "block";
      label.textContent = "配賦比率(%)";
    } else {
      section.style.display = "none";
    }
  }

  function saveDept() {
    var name = document.getElementById("dept-name").value.trim();
    if (!name) {
      app.showToast("工程名を入力してください", "error");
      return;
    }

    var dept = {
      department_name: name,
      worker_count: parseInt(document.getElementById("dept-worker-count").value) || 0,
      annual_labor_cost: parseFloat(document.getElementById("dept-annual-labor-cost").value) || 0,
      allocation_base_value: parseFloat(document.getElementById("dept-alloc-value").value) || 0,
      is_machine_based: document.getElementById("dept-is-machine-based").value === "true",
      standard_machine_cost: parseFloat(document.getElementById("dept-machine-cost").value) || 0,
      machine_count: parseInt(document.getElementById("dept-machine-count").value) || 0,
      machine_operating_hours: parseInt(document.getElementById("dept-machine-hours").value) || 0
    };

    var data = app.loadData();
    var idxStr = document.getElementById("dept-edit-idx").value;

    if (idxStr !== "") {
      var idx = parseInt(idxStr);
      dept.id = data.departments[idx].id;
      data.departments[idx] = dept;
    } else {
      dept.id = app.nextId(data.departments);
      data.departments.push(dept);
    }

    app.saveData(data);
    closeModal();
    app.showToast("部門を保存しました", "success");
    load();
  }

  function removeDept(idx) {
    if (!confirm("この部門を削除しますか？")) return;
    var data = app.loadData();
    data.departments.splice(idx, 1);
    app.saveData(data);
    app.showToast("部門を削除しました", "success");
    load();
  }

  app.deptCost = {
    init: init, load: load,
    editDept: editDept, removeDept: removeDept
  };

})(window.CostApp);
