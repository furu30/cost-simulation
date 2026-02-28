(function(app) {
  "use strict";

  var csFields = ["setting_name", "common_working_hours", "allocation_base_type"];
  var csIdMap = {
    setting_name: "cs-setting-name",
    common_working_hours: "cs-common-working-hours",
    allocation_base_type: "cs-alloc-type"
  };

  var plFields = ["sales", "sga_total", "sga_shipping"];
  var mcrFields = [
    "material_cost", "labor_wages", "labor_bonus", "labor_welfare",
    "outsourcing_cost", "exp_depreciation", "exp_consumables", "exp_repairs",
    "exp_lease", "exp_utilities", "exp_taxes", "exp_rent", "exp_other"
  ];

  var plIdMap = {
    sales: "pl-sales", sga_total: "pl-sga-total", sga_shipping: "pl-sga-shipping"
  };

  var mcrIdMap = {
    material_cost: "mcr-material", labor_wages: "mcr-wages",
    labor_bonus: "mcr-bonus", labor_welfare: "mcr-welfare",
    outsourcing_cost: "mcr-outsourcing", exp_depreciation: "mcr-depreciation",
    exp_consumables: "mcr-consumables", exp_repairs: "mcr-repairs",
    exp_lease: "mcr-lease", exp_utilities: "mcr-utilities",
    exp_taxes: "mcr-taxes", exp_rent: "mcr-rent", exp_other: "mcr-other"
  };

  function init() {
    document.getElementById("btn-save-base").addEventListener("click", save);

    // リアルタイムサマリー更新
    csFields.forEach(function(f) {
      document.getElementById(csIdMap[f]).addEventListener("input", updateSummary);
    });
    plFields.forEach(function(f) {
      var el = document.getElementById(plIdMap[f]);
      if (el) el.addEventListener("input", updateSummary);
    });
    mcrFields.forEach(function(f) {
      document.getElementById(mcrIdMap[f]).addEventListener("input", updateSummary);
    });

    load();
  }

  function load() {
    var data = app.loadData();
    var cs = data.companySettings;

    // 全社設定
    document.getElementById(csIdMap.setting_name).value = cs.setting_name || "";
    document.getElementById(csIdMap.common_working_hours).value = cs.common_working_hours || 0;
    document.getElementById(csIdMap.allocation_base_type).value = cs.allocation_base_type || "worker_count";

    // P&L
    plFields.forEach(function(f) {
      var el = document.getElementById(plIdMap[f]);
      if (el) el.value = data.plData[f] || 0;
    });
    // MCR
    mcrFields.forEach(function(f) {
      document.getElementById(mcrIdMap[f]).value = data.mcrData[f] || 0;
    });
    updateSummary();
  }

  function save() {
    var data = app.loadData();

    // 全社設定
    data.companySettings.setting_name = document.getElementById(csIdMap.setting_name).value.trim();
    data.companySettings.common_working_hours = parseInt(document.getElementById(csIdMap.common_working_hours).value) || 0;
    data.companySettings.allocation_base_type = document.getElementById(csIdMap.allocation_base_type).value;

    // P&L
    plFields.forEach(function(f) {
      var el = document.getElementById(plIdMap[f]);
      if (el) data.plData[f] = parseFloat(el.value) || 0;
    });
    // MCR
    mcrFields.forEach(function(f) {
      data.mcrData[f] = parseFloat(document.getElementById(mcrIdMap[f]).value) || 0;
    });

    // 間接費を再計算してから保存
    data.companySettings.common_indirect_expenses = app.calcAutoIndirect(data);
    app.saveData(data);
    app.showToast("全社設定を保存しました", "success");
  }

  function updateSummary() {
    var hours = parseInt(document.getElementById("cs-common-working-hours").value) || 0;

    // ── フォームから現在値を読み取って間接費を計算 ──
    var mcrTotal = 0;
    mcrFields.forEach(function(f) {
      mcrTotal += parseFloat(document.getElementById(mcrIdMap[f]).value) || 0;
    });
    var mat = parseFloat(document.getElementById("mcr-material").value) || 0;
    var outsource = parseFloat(document.getElementById("mcr-outsourcing").value) || 0;

    // 部門の直接人件費合計(千円変換) — 保存済みデータから取得
    var data = app.loadData();
    var depts = data.departments || [];
    var totalLaborK = 0;
    depts.forEach(function(d) { totalLaborK += (d.annual_labor_cost || 0) / 1000; });

    // 製造間接費(千円)
    var mfgIndirect = mcrTotal - mat - outsource - totalLaborK;

    // P&L値
    var sales = parseFloat(document.getElementById("pl-sales").value) || 0;
    var sgaTotal = parseFloat(document.getElementById("pl-sga-total").value) || 0;
    var sgaShipping = parseFloat(document.getElementById("pl-sga-shipping").value) || 0;

    // 運送費控除
    var cs = data.companySettings;
    var freightDeduction = cs.enable_freight_cost ? sgaShipping : 0;

    // 間接費合計(千円)
    var indirectTotalK = Math.max(0, mfgIndirect + sgaTotal - freightDeduction);
    // 間接費合計(円)
    var indirectTotalYen = Math.round(indirectTotalK * 1000);

    // companySettings を一時的に上書きしてレート計算
    var tempCs = {};
    for (var k in cs) { tempCs[k] = cs[k]; }
    tempCs.common_working_hours = hours;
    tempCs.common_indirect_expenses = indirectTotalYen;

    // ── 全社設定サマリー（方式1のみ表示） ──
    var csSummary = document.getElementById("cs-summary");
    var level = cs.calc_level || 1;
    if (level === 1 && hours > 0 && depts.length > 0) {
      var lv1 = app.calcEngine.calcLv1Rate(tempCs, depts);
      csSummary.innerHTML =
        "全社統一レート: <strong>" + app.formatNum(Math.round(lv1.hourlyRate)) + " 円/h</strong>" +
        "　｜　稼働時間合計: " + app.formatNum(lv1.totalHours) + " h";
      csSummary.style.display = "";
    } else if (level === 1) {
      csSummary.innerHTML = '<span class="text-muted">共通年間労働時間を入力し、部門を登録してください</span>';
      csSummary.style.display = "";
    } else {
      // 方式2/3/4 はこのサマリー行自体を非表示
      csSummary.innerHTML = "";
      csSummary.style.display = "none";
    }

    // ── 間接費内訳サマリー（製造/販管分離） ──
    var sgaNetK = sgaTotal - freightDeduction;
    var mfgIndirectYen = Math.round(mfgIndirect * 1000);
    var sgaIndirectYen = Math.round(sgaNetK * 1000);

    var indirectSummary = document.getElementById("indirect-summary");
    if (mcrTotal > 0 || sgaTotal > 0) {
      var html = "間接費合計(自動計算): <strong>" + app.formatNum(indirectTotalYen) + " 円</strong>" +
        "（" + app.formatNum(Math.round(indirectTotalK)) + " 千円）";
      html += "<br><span style='font-size:11px'>" +
        "① 製造間接費: <strong>" + app.formatNum(Math.round(mfgIndirect)) + "</strong> 千円" +
        "（製造原価合計 " + app.formatNum(Math.round(mcrTotal)) +
        " − 材料 " + app.formatNum(Math.round(mat)) +
        " − 外注 " + app.formatNum(Math.round(outsource)) +
        " − 直接人件費 " + app.formatNum(Math.round(totalLaborK)) + "）" +
        "<br>② 販管費: <strong>" + app.formatNum(Math.round(sgaNetK)) + "</strong> 千円";
      if (freightDeduction > 0) {
        html += "（販管費 " + app.formatNum(Math.round(sgaTotal)) + " − 運送費 " + app.formatNum(Math.round(freightDeduction)) + "）";
      }
      html += "</span>";
      indirectSummary.innerHTML = html;
      indirectSummary.style.display = "";
    } else {
      indirectSummary.innerHTML = "";
      indirectSummary.style.display = "none";
    }

    // ── P&Lサマリー ──
    document.getElementById("pl-summary").innerHTML =
      "販管費: <strong>" + app.formatNum(sgaTotal) + "</strong> 千円" +
      "　｜　売上高: " + app.formatNum(sales) + " 千円";

    // ── 製造原価サマリー ──
    var wages = parseFloat(document.getElementById("mcr-wages").value) || 0;
    var bonus = parseFloat(document.getElementById("mcr-bonus").value) || 0;
    var welfare = parseFloat(document.getElementById("mcr-welfare").value) || 0;
    var laborTotal = wages + bonus + welfare;

    var expTotal = 0;
    ["exp_depreciation", "exp_consumables", "exp_repairs", "exp_lease",
     "exp_utilities", "exp_taxes", "exp_rent", "exp_other"].forEach(function(f) {
      expTotal += parseFloat(document.getElementById(mcrIdMap[f]).value) || 0;
    });

    document.getElementById("mcr-summary").innerHTML =
      "材料費: " + app.formatNum(mat) +
      " ｜ 労務費: " + app.formatNum(laborTotal) +
      " ｜ 外注費: " + app.formatNum(outsource) +
      " ｜ 経費: " + app.formatNum(expTotal) +
      "<br><strong>製造原価合計: " + app.formatNum(mcrTotal) + " 千円</strong>";
  }

  app.baseData = { init: init, load: load };

})(window.CostApp);
