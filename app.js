(function() {
  "use strict";

  var STORAGE_KEY = "costSimDataV3";

  // ══ デフォルトデータ（テーブル定義書準拠） ══
  function defaultData() {
    return {
      /** company_settings テーブル */
      companySettings: {
        setting_name: "",
        calc_level: 1,             // 1:簡易, 2:全社統一(D/I分離), 3:部門別(人手), 4:部門別(機械混在)
        enable_freight_cost: false,
        freight_rate_per_unit: 0,   // 円/kg
        common_working_hours: 0,    // 年間総労働時間(h)
        common_indirect_expenses: 0, // 全社共通間接費(円)
        allocation_base_type: "worker_count" // 配賦基準区分（全社統一）
      },
      /** P&L参考データ */
      plData: { sales: 0, sga_total: 0, sga_shipping: 0 },
      /** 製造原価報告書参考データ */
      mcrData: {
        material_cost: 0, labor_wages: 0, labor_bonus: 0, labor_welfare: 0,
        outsourcing_cost: 0, exp_depreciation: 0, exp_consumables: 0, exp_repairs: 0,
        exp_lease: 0, exp_utilities: 0, exp_taxes: 0, exp_rent: 0, exp_other: 0
      },
      /** 直間区分設定（方式2以上で使用） */
      costSplitSettings: {
        split_mode: "ratio",              // "ratio" = A案(%), "amount" = B案(金額)
        material_direct_ratio: 100,       // 材料費の直接費率(%)
        outsourcing_direct_ratio: 100,    // 外注費の直接費率(%)
        shipping_direct_ratio: 100,       // 運送費の直接費率(%)
        material_indirect_amount: 0,      // 材料費の間接費分(千円) B案用
        outsourcing_indirect_amount: 0,   // 外注費の間接費分(千円) B案用
        shipping_indirect_amount: 0       // 運送費の間接費分(千円) B案用
      },
      /** departments テーブル */
      departments: [],
      /** products テーブル + product_routings */
      products: []
    };
  }

  // ══ localStorage ══
  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultData();
      var d = JSON.parse(raw);
      var def = defaultData();
      for (var k in def) {
        if (d[k] === undefined) d[k] = def[k];
      }
      if (d.companySettings) {
        for (var sk in def.companySettings) {
          if (d.companySettings[sk] === undefined) d.companySettings[sk] = def.companySettings[sk];
        }
      }
      // 後方互換: 配賦基準区分を全社設定にマイグレーション
      if (!d.companySettings.allocation_base_type && d.departments && d.departments.length > 0) {
        d.companySettings.allocation_base_type = d.departments[0].allocation_base_type || "worker_count";
      }
      // 後方互換: costSplitSettings
      if (!d.costSplitSettings) d.costSplitSettings = def.costSplitSettings;
      for (var ck in def.costSplitSettings) {
        if (d.costSplitSettings[ck] === undefined) d.costSplitSettings[ck] = def.costSplitSettings[ck];
      }
      // 後方互換: 旧P&Lフィールドを sga_total にマイグレーション
      if (d.plData && d.plData.sga_total === undefined) {
        d.plData.sga_total = (d.plData.sga_personnel || 0) + (d.plData.sga_management || 0) + (d.plData.sga_shipping || 0);
        delete d.plData.sga_personnel;
        delete d.plData.sga_management;
      }
      // 間接費を自動計算（製造/販管分離）
      var indirect = calcAutoIndirect(d);
      d.companySettings.common_indirect_expenses = indirect.total;
      d.companySettings.mfg_indirect_expenses = indirect.mfgIndirect;
      d.companySettings.sga_indirect_expenses = indirect.sgaIndirect;
      return d;
    } catch (e) {
      return defaultData();
    }
  }

  /**
   * 間接費自動計算（製造間接費 / 販管費 分離）
   * 製造間接費(千円) = MCR合計 − 材料費 − 外注費 − Σ(部門年間人件費÷1000)
   * 販管費(千円) = P&L販管費 [− 運送費 if freight ON]
   * @returns {{ mfgIndirect: number, sgaIndirect: number, total: number }} 全て円
   */
  function calcAutoIndirect(data) {
    var mcr = data.mcrData || {};
    var pl = data.plData || {};
    var cs = data.companySettings || {};
    var depts = data.departments || [];

    // MCR合計(千円)
    var mcrKeys = ["material_cost", "labor_wages", "labor_bonus", "labor_welfare",
      "outsourcing_cost", "exp_depreciation", "exp_consumables", "exp_repairs",
      "exp_lease", "exp_utilities", "exp_taxes", "exp_rent", "exp_other"];
    var mcrTotal = 0;
    mcrKeys.forEach(function(k) { mcrTotal += (mcr[k] || 0); });

    // 部門の直接人件費合計(千円変換)
    var totalLaborK = 0;
    depts.forEach(function(d) { totalLaborK += (d.annual_labor_cost || 0) / 1000; });

    // 直間区分設定を適用
    var split = data.costSplitSettings || {};
    var level = cs.calc_level || 1;
    var materialDirect, outsourcingDirect;

    if (level >= 2 && split.split_mode === "amount") {
      // B案: 金額指定 → 直接分 = 全額 − 間接費分
      materialDirect = (mcr.material_cost || 0) - (split.material_indirect_amount || 0);
      outsourcingDirect = (mcr.outsourcing_cost || 0) - (split.outsourcing_indirect_amount || 0);
    } else if (level >= 2) {
      // A案: 割合指定
      materialDirect = (mcr.material_cost || 0) * ((split.material_direct_ratio != null ? split.material_direct_ratio : 100) / 100);
      outsourcingDirect = (mcr.outsourcing_cost || 0) * ((split.outsourcing_direct_ratio != null ? split.outsourcing_direct_ratio : 100) / 100);
    } else {
      // 方式1: 全額直接扱い
      materialDirect = mcr.material_cost || 0;
      outsourcingDirect = mcr.outsourcing_cost || 0;
    }

    // 製造間接費(千円) = MCR合計 − 直接材料費 − 直接外注費 − 直接人件費
    var mfgIndirectK = mcrTotal - materialDirect - outsourcingDirect - totalLaborK;

    // 販管費(千円): 運送費の直接分のみ控除(freight ON時)
    var shippingTotal = cs.enable_freight_cost ? (pl.sga_shipping || 0) : 0;
    var shippingDirect = 0;
    if (shippingTotal > 0 && level >= 2) {
      if (split.split_mode === "amount") {
        shippingDirect = shippingTotal - (split.shipping_indirect_amount || 0);
      } else {
        shippingDirect = shippingTotal * ((split.shipping_direct_ratio != null ? split.shipping_direct_ratio : 100) / 100);
      }
    } else {
      shippingDirect = shippingTotal; // 方式1または未設定: 全額直接
    }
    var freightDeduction = shippingDirect;
    var sgaNetK = (pl.sga_total || 0) - freightDeduction;

    // 合計(千円)
    var totalK = mfgIndirectK + sgaNetK;

    return {
      mfgIndirect: Math.round(mfgIndirectK * 1000),
      sgaIndirect: Math.round(sgaNetK * 1000),
      total: Math.round(Math.max(0, totalK) * 1000)
    };
  }

  function saveData(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      showToast("保存に失敗しました", "error");
    }
  }

  // ══ ユーティリティ ══
  function showToast(msg, type) {
    type = type || "info";
    var el = document.createElement("div");
    el.className = "toast " + type;
    el.textContent = msg;
    document.getElementById("toast-container").appendChild(el);
    setTimeout(function() { el.remove(); }, 3000);
  }

  function formatNum(n) {
    if (n == null || isNaN(n)) return "0";
    return Number(n).toLocaleString("ja-JP");
  }

  function formatYen(n) {
    return formatNum(Math.round(n));
  }

  function escHtml(s) {
    if (!s) return "";
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function nextId(arr) {
    if (!arr.length) return 1;
    return Math.max.apply(null, arr.map(function(x) { return x.id || 0; })) + 1;
  }

  // ══ タブ制御 ══
  var tabCallbacks = {};

  function initTabs() {
    document.querySelector(".tab-bar").addEventListener("click", function(e) {
      var btn = e.target.closest(".tab-item");
      if (!btn) return;
      switchTab(btn.dataset.tab);
    });
  }

  function switchTab(tabId) {
    document.querySelectorAll(".tab-item").forEach(function(t) { t.classList.remove("active"); });
    document.querySelectorAll(".tab-panel").forEach(function(p) { p.classList.remove("active"); });
    var btn = document.querySelector('[data-tab="' + tabId + '"]');
    var panel = document.getElementById(tabId);
    if (btn) btn.classList.add("active");
    if (panel) panel.classList.add("active");
    if (tabCallbacks[tabId]) tabCallbacks[tabId]();
  }

  function onTabSwitch(tabId, cb) {
    tabCallbacks[tabId] = cb;
  }

  // ══ JSON書き出し/読み込み ══
  function initHeaderActions() {
    document.getElementById("btn-reset-data").addEventListener("click", function() {
      var data = loadData();
      var deptCount = data.departments.length;
      var prodCount = data.products.length;
      var msg = "すべてのデータを削除して初期状態に戻します。\n\n";
      if (deptCount || prodCount) {
        msg += "現在のデータ:\n";
        if (deptCount) msg += "・部門: " + deptCount + "件\n";
        if (prodCount) msg += "・製品: " + prodCount + "件\n";
        msg += "\nこれらはすべて失われます。";
      }
      msg += "\n\nよろしいですか？";
      if (!confirm(msg)) return;
      saveData(defaultData());
      showToast("データを初期化しました", "success");
      reloadAll();
    });

    document.getElementById("btn-demo-data").addEventListener("click", function() {
      var data = loadData();
      var hasData = data.departments.length > 0 || data.products.length > 0 || data.companySettings.setting_name;
      var msg = hasData
        ? "現在のデータをすべて削除し、デモデータ（5部門・3製品）を投入します。\n既存データは失われます。よろしいですか？"
        : "デモデータ（5部門・3製品）を投入します。よろしいですか？";
      if (!confirm(msg)) return;
      saveData(buildDemoData());
      showToast("デモデータを投入しました", "success");
      reloadAll();
    });

    document.getElementById("btn-export").addEventListener("click", function() {
      var data = loadData();
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "cost_sim_data.json";
      a.click();
      URL.revokeObjectURL(url);
    });

    document.getElementById("btn-import").addEventListener("click", function() {
      document.getElementById("file-import").click();
    });

    document.getElementById("file-import").addEventListener("change", function(e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(ev) {
        try {
          var data = JSON.parse(ev.target.result);
          saveData(data);
          showToast("データを読み込みました", "success");
          reloadAll();
        } catch (err) {
          showToast("JSONファイルの読み込みに失敗しました", "error");
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    });

    // 使い方ガイドボタン
    document.getElementById("btn-guide").addEventListener("click", function() {
      switchTab("tab-guide");
    });
  }

  function reloadAll() {
    var data = loadData();
    applyCalcLevel(data.companySettings.calc_level || 1);
    syncFreightToggle(data);
    if (window.CostApp.baseData) window.CostApp.baseData.load();
    if (window.CostApp.deptCost) window.CostApp.deptCost.load();
    if (window.CostApp.productCost) window.CostApp.productCost.load();
  }

  // ══ デモデータ ══
  function buildDemoData() {
    return {
      companySettings: {
        setting_name: "2024年度 標準設定",
        calc_level: 3,
        enable_freight_cost: false,
        freight_rate_per_unit: 100,
        common_working_hours: 1800,
        common_indirect_expenses: 0, // 自動計算される
        allocation_base_type: "worker_count"
      },
      plData: {
        sales: 1425000, sga_total: 88410, sga_shipping: 0
      },
      mcrData: {
        material_cost: 613170, labor_wages: 107920, labor_bonus: 26980,
        labor_welfare: 4500, outsourcing_cost: 331500, exp_depreciation: 42900,
        exp_consumables: 1310, exp_repairs: 8980, exp_lease: 9600,
        exp_utilities: 11400, exp_taxes: 1800, exp_rent: 4700, exp_other: 1300
      },
      departments: [
        {
          id: 1, department_name: "シート（NC）", worker_count: 8,
          labor_cost_per_person: 3500000, annual_labor_cost: 28000000,
          allocation_base_type: "worker_count",
          allocation_base_value: 0, is_machine_based: true,
          standard_machine_cost: 28584000, machine_count: 6,
          machine_operating_hours: 3960
        },
        {
          id: 2, department_name: "プレス", worker_count: 10,
          labor_cost_per_person: 3200000, annual_labor_cost: 32000000,
          allocation_base_type: "worker_count",
          allocation_base_value: 0, is_machine_based: false,
          standard_machine_cost: 4800000, machine_count: 0, machine_operating_hours: 0
        },
        {
          id: 3, department_name: "曲げ", worker_count: 6,
          labor_cost_per_person: 3300000, annual_labor_cost: 19800000,
          allocation_base_type: "worker_count",
          allocation_base_value: 0, is_machine_based: false,
          standard_machine_cost: 3600000, machine_count: 0, machine_operating_hours: 0
        },
        {
          id: 4, department_name: "溶接", worker_count: 12,
          labor_cost_per_person: 3400000, annual_labor_cost: 40800000,
          allocation_base_type: "worker_count",
          allocation_base_value: 0, is_machine_based: false,
          standard_machine_cost: 2400000, machine_count: 0, machine_operating_hours: 0
        },
        {
          id: 5, department_name: "塗装仕上", worker_count: 5,
          labor_cost_per_person: 3100000, annual_labor_cost: 15500000,
          allocation_base_type: "worker_count",
          allocation_base_value: 0, is_machine_based: false,
          standard_machine_cost: 1800000, machine_count: 0, machine_operating_hours: 0
        }
      ],
      products: [
        {
          id: 1, product_code: "A", product_name: "製品A",
          target_sales_price: 1775, direct_material_cost: 817,
          direct_outsourcing_cost: 0, freight_weight: 0, special_direct_expense: 0,
          routings: [
            { department_id: 1, process_order: 1, working_hours: 0.0167 },
            { department_id: 3, process_order: 2, working_hours: 0.0333 },
            { department_id: 4, process_order: 3, working_hours: 0.0833 },
            { department_id: 5, process_order: 4, working_hours: 0.05 }
          ]
        },
        {
          id: 2, product_code: "B", product_name: "製品B",
          target_sales_price: 2708, direct_material_cost: 1083,
          direct_outsourcing_cost: 650, freight_weight: 0, special_direct_expense: 0,
          routings: [
            { department_id: 1, process_order: 1, working_hours: 0.0167 },
            { department_id: 3, process_order: 2, working_hours: 0.0667 },
            { department_id: 5, process_order: 3, working_hours: 0.05 }
          ]
        },
        {
          id: 3, product_code: "C", product_name: "製品C",
          target_sales_price: 3333, direct_material_cost: 1333,
          direct_outsourcing_cost: 0, freight_weight: 0, special_direct_expense: 0,
          routings: [
            { department_id: 1, process_order: 1, working_hours: 0.0167 },
            { department_id: 3, process_order: 2, working_hours: 0.0833 },
            { department_id: 4, process_order: 3, working_hours: 0.1667 },
            { department_id: 5, process_order: 4, working_hours: 0.0833 }
          ]
        }
      ]
    };
  }

  // ══ 方式制御 ══
  function applyCalcLevel(level) {
    // 全方式で部門タブを表示（レート計算に部門データが必要）
    var deptTabBtn = document.querySelector('[data-tab="tab-dept"]');
    if (deptTabBtn) deptTabBtn.style.display = "";

    document.querySelectorAll(".level-btn").forEach(function(btn) {
      btn.classList.toggle("active", parseInt(btn.dataset.level) === level);
    });

    // 方式4: 機械設備セクション表示
    var machineSection = document.getElementById("machine-section");
    if (machineSection) machineSection.style.display = level >= 4 ? "block" : "none";

    // 方式2以上: 直間区分セクション表示
    var costSplitSection = document.getElementById("cost-split-section");
    if (costSplitSection) costSplitSection.style.display = level >= 2 ? "" : "none";

    document.body.dataset.calcLevel = level;
  }

  function initLevelSelector() {
    var data = loadData();
    applyCalcLevel(data.companySettings.calc_level || 1);

    document.getElementById("level-selector").addEventListener("click", function(e) {
      var btn = e.target.closest(".level-btn");
      if (!btn) return;
      var newLevel = parseInt(btn.dataset.level);
      var data = loadData();
      data.companySettings.calc_level = newLevel;
      saveData(data);
      applyCalcLevel(newLevel);
      reloadAll();
      showToast("原価計算方式を方式" + newLevel + "に変更しました", "success");
    });
  }

  function syncFreightToggle(data) {
    var toggle = document.getElementById("freight-toggle");
    var statusEl = document.getElementById("freight-status");
    var rateField = document.getElementById("freight-rate-field");
    var rateInput = document.getElementById("freight-rate");
    toggle.checked = data.companySettings.enable_freight_cost;
    rateInput.value = data.companySettings.freight_rate_per_unit || 0;
    statusEl.textContent = toggle.checked ? "ON" : "OFF";
    rateField.style.display = toggle.checked ? "flex" : "none";
    // P&L運送費行の表示切替
    var plShipRow = document.getElementById("pl-shipping-row");
    if (plShipRow) plShipRow.style.display = toggle.checked ? "" : "none";
  }

  function initFreightToggle() {
    var toggle = document.getElementById("freight-toggle");
    var statusEl = document.getElementById("freight-status");
    var rateField = document.getElementById("freight-rate-field");
    var rateInput = document.getElementById("freight-rate");

    syncFreightToggle(loadData());

    toggle.addEventListener("change", function() {
      var data = loadData();
      data.companySettings.enable_freight_cost = toggle.checked;
      saveData(data);
      statusEl.textContent = toggle.checked ? "ON" : "OFF";
      rateField.style.display = toggle.checked ? "flex" : "none";
      // P&L運送費行の表示切替
      var plShipRow = document.getElementById("pl-shipping-row");
      if (plShipRow) plShipRow.style.display = toggle.checked ? "" : "none";
      // 間接費を再計算して更新
      if (window.CostApp.baseData) window.CostApp.baseData.load();
    });

    rateInput.addEventListener("change", function() {
      var data = loadData();
      data.companySettings.freight_rate_per_unit = parseFloat(rateInput.value) || 0;
      saveData(data);
    });
  }

  // ══ Escキーでモーダルを閉じる ══
  function initEscapeKey() {
    document.addEventListener("keydown", function(e) {
      if (e.key !== "Escape") return;
      // ローディング中は閉じない
      var loading = document.getElementById("loading-overlay");
      if (loading && loading.style.display !== "none") return;
      // 部門モーダル
      var deptModal = document.getElementById("dept-modal");
      if (deptModal && deptModal.style.display !== "none") {
        deptModal.style.display = "none";
        return;
      }
      // オンボーディングモーダル
      var onboard = document.getElementById("onboarding-modal");
      if (onboard && onboard.style.display !== "none") {
        onboard.style.display = "none";
        return;
      }
    });
  }

  // ══ 初回オンボーディング ══
  function initOnboarding() {
    var data = loadData();
    var cs = data.companySettings;
    var isEmpty = !cs.setting_name && data.departments.length === 0 && data.products.length === 0 && !cs.common_working_hours;
    if (!isEmpty) return;

    var modal = document.getElementById("onboarding-modal");
    if (!modal) return;
    modal.style.display = "";

    document.getElementById("btn-onboarding-demo").addEventListener("click", function() {
      modal.style.display = "none";
      // デモデータボタンのクリックをシミュレート
      var btnDemo = document.getElementById("btn-demo-data");
      if (btnDemo) btnDemo.click();
    });
    document.getElementById("btn-onboarding-skip").addEventListener("click", function() {
      modal.style.display = "none";
    });
  }

  // ══ 初期化 ══
  document.addEventListener("DOMContentLoaded", function() {
    initTabs();
    initHeaderActions();
    initLevelSelector();
    initFreightToggle();
    initEscapeKey();

    if (window.CostApp.baseData) window.CostApp.baseData.init();
    if (window.CostApp.deptCost) window.CostApp.deptCost.init();
    if (window.CostApp.productCost) window.CostApp.productCost.init();

    initOnboarding();
  });

  // ══ 公開API ══
  window.CostApp = {
    loadData: loadData,
    saveData: saveData,
    calcAutoIndirect: calcAutoIndirect,
    showToast: showToast,
    formatNum: formatNum,
    formatYen: formatYen,
    escHtml: escHtml,
    nextId: nextId,
    switchTab: switchTab,
    onTabSwitch: onTabSwitch,
    applyCalcLevel: applyCalcLevel
  };
})();
