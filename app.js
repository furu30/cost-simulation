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
        allocation_base_type: "operating_hours", // 配賦基準区分（製造間接費）
        sga_alloc_type: "operating_hours"       // 配賦基準区分（販管費）
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
        depreciation_direct_ratio: 0,     // 減価償却費の直接費率(%) ※部門機械費に含まれない分
        material_indirect_amount: 0,      // 材料費の間接費分(千円) B案用
        outsourcing_indirect_amount: 0,   // 外注費の間接費分(千円) B案用
        shipping_indirect_amount: 0,      // 運送費の間接費分(千円) B案用
        depreciation_indirect_amount: 0   // 減価償却費の間接費分(千円) B案用
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
    var materialDirect, outsourcingDirect, depreciationDirect;
    var depreciation = mcr.exp_depreciation || 0;

    if (level >= 2 && split.split_mode === "amount") {
      // B案: 金額指定 → 直接分 = 全額 − 間接費分
      materialDirect = (mcr.material_cost || 0) - (split.material_indirect_amount || 0);
      outsourcingDirect = (mcr.outsourcing_cost || 0) - (split.outsourcing_indirect_amount || 0);
      depreciationDirect = depreciation - (split.depreciation_indirect_amount || 0);
    } else if (level >= 2) {
      // A案: 割合指定
      materialDirect = (mcr.material_cost || 0) * ((split.material_direct_ratio != null ? split.material_direct_ratio : 100) / 100);
      outsourcingDirect = (mcr.outsourcing_cost || 0) * ((split.outsourcing_direct_ratio != null ? split.outsourcing_direct_ratio : 100) / 100);
      depreciationDirect = depreciation * ((split.depreciation_direct_ratio != null ? split.depreciation_direct_ratio : 0) / 100);
    } else {
      // 方式1: 全額直接扱い（減価償却は全額間接）
      materialDirect = mcr.material_cost || 0;
      outsourcingDirect = mcr.outsourcing_cost || 0;
      depreciationDirect = 0;
    }

    // 製造間接費(千円) = MCR合計 − 直接材料費 − 直接外注費 − 直接減価償却費 − 直接人件費
    var mfgIndirectK = mcrTotal - materialDirect - outsourcingDirect - depreciationDirect - totalLaborK;

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

    // 方式2以上: 販管費配賦基準・説明表示
    var sgaInfo = document.getElementById("sga-alloc-info");
    if (sgaInfo) sgaInfo.style.display = level >= 2 ? "" : "none";
    var sgaLabel = document.getElementById("sga-alloc-label");
    var sgaSelect = document.getElementById("cs-sga-alloc-type");
    if (sgaLabel) sgaLabel.style.display = level >= 2 ? "" : "none";
    if (sgaSelect) sgaSelect.style.display = level >= 2 ? "" : "none";

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
    toggle.checked = data.companySettings.enable_freight_cost;
    statusEl.textContent = toggle.checked ? "ON" : "OFF";
    // P&L運送費行の表示切替
    var plShipRow = document.getElementById("pl-shipping-row");
    if (plShipRow) plShipRow.style.display = toggle.checked ? "" : "none";
  }

  function initFreightToggle() {
    var toggle = document.getElementById("freight-toggle");
    var statusEl = document.getElementById("freight-status");

    syncFreightToggle(loadData());

    toggle.addEventListener("change", function() {
      var data = loadData();
      data.companySettings.enable_freight_cost = toggle.checked;
      saveData(data);
      statusEl.textContent = toggle.checked ? "ON" : "OFF";
      // P&L運送費行の表示切替
      var plShipRow = document.getElementById("pl-shipping-row");
      if (plShipRow) plShipRow.style.display = toggle.checked ? "" : "none";
      // 間接費を再計算して更新
      if (window.CostApp.baseData) window.CostApp.baseData.load();
    });
  }

  // ══ 方式選択ウィザード ══
  function initLevelWizard() {
    var btn = document.getElementById("btn-level-wizard");
    var modal = document.getElementById("level-wizard-modal");
    var closeBtn = document.getElementById("btn-wizard-close");
    var content = document.getElementById("wizard-content");
    if (!btn || !modal) return;

    btn.addEventListener("click", function() {
      showWizardStep(1);
      modal.style.display = "";
    });
    closeBtn.addEventListener("click", function() { modal.style.display = "none"; });
    modal.addEventListener("click", function(e) { if (e.target === modal) modal.style.display = "none"; });

    function showWizardStep(step, answers) {
      answers = answers || {};
      var html = '';
      if (step === 1) {
        html += '<div class="wizard-question">';
        html += '<p style="font-size:15px;font-weight:600;margin-bottom:12px">Q1. まずは簡単に原価を把握したいですか？<br>それとも工程ごとの詳細なコストを知りたいですか？</p>';
        html += '<div class="wizard-options">';
        html += '<button class="btn btn-outline wizard-opt" style="width:100%;text-align:left;padding:12px 16px;margin-bottom:8px" data-val="simple"><strong>まずは全体像を把握したい</strong><br><span style="font-size:12px;color:var(--text-muted)">工程の差は気にせず、製品ごとの利益がわかればOK</span></button>';
        html += '<button class="btn btn-outline wizard-opt" style="width:100%;text-align:left;padding:12px 16px" data-val="detail"><strong>工程ごとのコストを詳しく知りたい</strong><br><span style="font-size:12px;color:var(--text-muted)">どの工程にコストがかかっているか分析したい</span></button>';
        html += '</div></div>';
      } else if (step === 2 && answers.q1 === "simple") {
        html += '<div class="wizard-question">';
        html += '<p style="font-size:15px;font-weight:600;margin-bottom:12px">Q2. 直接費と間接費を分けて分析したいですか？</p>';
        html += '<div class="wizard-options">';
        html += '<button class="btn btn-outline wizard-opt" style="width:100%;text-align:left;padding:12px 16px;margin-bottom:8px" data-val="no"><strong>分けなくてよい</strong><br><span style="font-size:12px;color:var(--text-muted)">とにかくシンプルに原価と利益を知りたい</span></button>';
        html += '<button class="btn btn-outline wizard-opt" style="width:100%;text-align:left;padding:12px 16px" data-val="yes"><strong>分けて分析したい</strong><br><span style="font-size:12px;color:var(--text-muted)">間接費の影響も把握したい</span></button>';
        html += '</div></div>';
      } else if (step === 2 && answers.q1 === "detail") {
        html += '<div class="wizard-question">';
        html += '<p style="font-size:15px;font-weight:600;margin-bottom:12px">Q2. 機械の稼働時間が作業者の就業時間と異なる工程はありますか？</p>';
        html += '<div class="wizard-options">';
        html += '<button class="btn btn-outline wizard-opt" style="width:100%;text-align:left;padding:12px 16px;margin-bottom:8px" data-val="no"><strong>ない（人手主体の工程のみ）</strong><br><span style="font-size:12px;color:var(--text-muted)">作業者の就業時間＝工程の稼働時間である</span></button>';
        html += '<button class="btn btn-outline wizard-opt" style="width:100%;text-align:left;padding:12px 16px" data-val="yes"><strong>ある（機械主体の工程がある）</strong><br><span style="font-size:12px;color:var(--text-muted)">多台持ち、夜間無人運転など、機械稼働時間と人の就業時間が異なる工程がある</span></button>';
        html += '</div></div>';
      } else if (step === 3) {
        // 結果表示
        var rec = 1;
        if (answers.q1 === "simple" && answers.q2 === "no") rec = 1;
        else if (answers.q1 === "simple" && answers.q2 === "yes") rec = 2;
        else if (answers.q1 === "detail" && answers.q2 === "no") rec = 3;
        else if (answers.q1 === "detail" && answers.q2 === "yes") rec = 4;

        var names = { 1: "方式1：簡易方式", 2: "方式2：全社統一（直間分離）", 3: "方式3：部門別（人手主体）", 4: "方式4：部門別（機械混在）" };
        var descs = {
          1: "全工程同一の統一レートで計算します。最もシンプルで、まず全体の利益を把握するのに最適です。",
          2: "統一レートですが、直接費と間接費を分離します。限界利益・貢献利益の分析が可能になります。",
          3: "工程ごとに異なるアワーレートを算出します。どの工程にコストがかかっているか詳しく分析できます。",
          4: "方式3に加え、機械主体の工程を区別して計算します。多台持ちや夜間無人運転など、機械稼働時間が人の就業時間と異なる工程がある場合に最適です。"
        };
        html += '<div style="text-align:center;padding:16px">';
        html += '<div style="font-size:14px;color:var(--text-muted);margin-bottom:8px">おすすめの方式</div>';
        html += '<div style="font-size:22px;font-weight:700;color:var(--primary);margin-bottom:8px">' + names[rec] + '</div>';
        html += '<p style="font-size:14px;color:var(--text);margin-bottom:20px">' + descs[rec] + '</p>';
        html += '<button class="btn btn-primary wizard-apply" data-level="' + rec + '" style="padding:10px 32px;font-size:15px">この方式を設定する</button>';
        html += '<p style="margin-top:8px;font-size:12px;color:var(--text-muted)">後からいつでも変更できます</p>';
        html += '</div>';
      }

      content.innerHTML = html;

      // イベント登録
      content.querySelectorAll(".wizard-opt").forEach(function(optBtn) {
        optBtn.addEventListener("click", function() {
          if (step === 1) { answers.q1 = optBtn.dataset.val; showWizardStep(2, answers); }
          else if (step === 2) { answers.q2 = optBtn.dataset.val; showWizardStep(3, answers); }
        });
      });
      var applyBtn = content.querySelector(".wizard-apply");
      if (applyBtn) {
        applyBtn.addEventListener("click", function() {
          var lv = parseInt(applyBtn.dataset.level);
          var data = loadData();
          data.companySettings.calc_level = lv;
          saveData(data);
          applyCalcLevel(lv);
          reloadAll();
          modal.style.display = "none";
          showToast("方式" + lv + "に設定しました", "success");
        });
      }
    }
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
      // ウィザードモーダル
      var wizard = document.getElementById("level-wizard-modal");
      if (wizard && wizard.style.display !== "none") {
        wizard.style.display = "none";
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

  // ══ カバーページ ══
  function initCoverPage() {
    var cover = document.getElementById("cover-page");
    if (!cover) return;
    var data = loadData();
    var cs = data.companySettings;
    var isEmpty = !cs.setting_name && data.departments.length === 0 && data.products.length === 0 && !cs.common_working_hours;

    if (!isEmpty) {
      cover.style.display = "none";
      return;
    }

    document.getElementById("btn-cover-start").addEventListener("click", function() {
      // ボタンにパルス効果
      this.style.transform = "scale(1.1)";
      this.style.boxShadow = "0 0 40px rgba(37,99,235,0.6)";
      setTimeout(function() {
        cover.classList.add("hide");
        setTimeout(function() {
          cover.style.display = "none";
          initOnboarding();
        }, 600);
      }, 200);
    });
  }

  // ══ 初回オンボーディング ══
  function initOnboarding() {
    var modal = document.getElementById("onboarding-modal");
    if (!modal) return;
    modal.style.display = "";

    document.getElementById("btn-onboarding-demo").addEventListener("click", function() {
      modal.style.display = "none";
      // デモデータボタンのクリックをシミュレート
      var btnDemo = document.getElementById("btn-demo-data");
      if (btnDemo) btnDemo.click();
    });
    document.getElementById("btn-onboarding-guide").addEventListener("click", function() {
      modal.style.display = "none";
      if (window.CostApp.startStepGuide) window.CostApp.startStepGuide();
    });
    document.getElementById("btn-onboarding-skip").addEventListener("click", function() {
      modal.style.display = "none";
    });
  }

  // ══ ステップバイステップ入力ガイド ══
  function initStepGuide() {
    var modal = document.getElementById("step-guide-modal");
    var titleEl = document.getElementById("step-guide-title");
    var progressEl = document.getElementById("step-guide-progress");
    var contentEl = document.getElementById("step-guide-content");
    var prevBtn = document.getElementById("btn-step-prev");
    var nextBtn = document.getElementById("btn-step-next");
    if (!modal) return;

    var steps = [
      {
        title: "決算書を手元に準備してください",
        html: '<p style="font-size:14px;line-height:1.8;margin-bottom:12px">このガイドでは、以下の決算書の数値を順番に入力していきます。</p>' +
          '<div style="background:var(--bg);border-radius:6px;padding:12px 16px;font-size:13px;line-height:2">' +
          '<strong>必要な書類：</strong><br>' +
          '1. <strong>損益計算書（P&L）</strong> — 売上高、販管費<br>' +
          '2. <strong>製造原価報告書</strong> — 材料費、労務費、外注費、経費の内訳<br>' +
          '3. <strong>部門別の情報</strong> — 各工程の作業者数、人件費、設備費用</div>' +
          '<p style="font-size:13px;color:var(--text-muted);margin-top:8px">すべて千円単位で入力します。100万円 → 1000 と入力します。</p>'
      },
      {
        title: "売上高と販管費を入力",
        html: '<p style="font-size:14px;line-height:1.8;margin-bottom:12px">損益計算書（P&L）から、<strong>売上高</strong>と<strong>販管費</strong>を入力してください。</p>' +
          '<div class="form-grid" style="max-width:400px">' +
          '<label>売上高（千円）</label><input type="number" id="sg-pl-sales" class="input-num" step="1">' +
          '<label>販管費（千円）</label><input type="number" id="sg-pl-sga" class="input-num" step="1">' +
          '</div>' +
          '<div class="help-example" style="margin-top:12px;padding:8px 12px;background:var(--bg);border-radius:6px;font-size:12px">' +
          '売上高14億2,500万円 → <strong>1425000</strong>　販管費8,841万円 → <strong>88410</strong></div>'
      },
      {
        title: "製造原価報告書の主要項目を入力",
        html: '<p style="font-size:14px;line-height:1.8;margin-bottom:12px">製造原価報告書から主要な費目を入力してください。</p>' +
          '<div class="form-grid" style="max-width:400px">' +
          '<label>材料費（千円）</label><input type="number" id="sg-mcr-mat" class="input-num" step="1">' +
          '<label>労務費合計（千円）</label><input type="number" id="sg-mcr-labor" class="input-num" step="1">' +
          '<label>外注加工費（千円）</label><input type="number" id="sg-mcr-out" class="input-num" step="1">' +
          '<label>経費合計（千円）</label><input type="number" id="sg-mcr-exp" class="input-num" step="1">' +
          '</div>' +
          '<div class="help-example" style="margin-top:12px;padding:8px 12px;background:var(--bg);border-radius:6px;font-size:12px">' +
          '労務費合計 = 賃金＋賞与＋福利厚生費<br>経費合計 = 減価償却費＋消耗品費＋修繕費＋リース料＋電力費＋その他</div>'
      },
      {
        title: "年間労働時間を入力",
        html: '<p style="font-size:14px;line-height:1.8;margin-bottom:12px">1人あたりの年間稼働時間を入力してください。</p>' +
          '<div class="form-grid" style="max-width:400px">' +
          '<label>年間労働時間(h)</label><input type="number" id="sg-hours" class="input-num" step="1" value="1800">' +
          '</div>' +
          '<div class="help-example" style="margin-top:12px;padding:8px 12px;background:var(--bg);border-radius:6px;font-size:12px">' +
          '一般的な目安：<br>年間250日 × 7.2時間 = <strong>1,800時間</strong><br>年間240日 × 8時間 = <strong>1,920時間</strong></div>'
      },
      {
        title: "入力完了！",
        html: '<div style="text-align:center;padding:20px 0">' +
          '<div style="font-size:40px;margin-bottom:12px">🎉</div>' +
          '<p style="font-size:16px;font-weight:600;margin-bottom:8px">基本データの入力が完了しました</p>' +
          '<p style="font-size:14px;color:var(--text-muted);line-height:1.8">全社設定タブにデータが反映されています。<br>次は「部門（工程）」タブで各工程の情報を登録してください。</p>' +
          '</div>'
      }
    ];

    // 部門ガイドのステップ（方式別に動的生成）
    function buildDeptSteps() {
      var data = loadData();
      var level = data.companySettings.calc_level || 1;
      var isLv4 = level >= 4;
      var machineFields = isLv4
        ? '<label>稼働形態</label><select id="sg-dept-machine-based" style="font-size:14px;padding:6px 10px"><option value="false">人手主体</option><option value="true">機械主体（稼働時間≠就業時間）</option></select>' +
          '<label>設備台数</label><input type="number" id="sg-dept-machine-count" class="input-num" step="1" value="0">' +
          '<label>1台あたり稼働時間(h/年)</label><input type="number" id="sg-dept-machine-hours" class="input-num" step="1" value="0">'
        : '';
      var machineHelp = isLv4
        ? '<br>機械主体：多台持ちや夜間無人運転など、機械稼働時間≠就業時間の場合に選択'
        : '';
      return [
        {
          title: "部門（工程）を登録しましょう",
          html: '<p style="font-size:14px;line-height:1.8;margin-bottom:12px">製品が通る各工程を「部門」として登録します。工程ごとのコストを把握するために必要です。</p>' +
            '<div style="background:var(--bg);border-radius:6px;padding:12px 16px;font-size:13px;line-height:2">' +
            '<strong>準備するもの：</strong><br>' +
            '・各工程の<strong>直接作業者数</strong><br>' +
            '・作業者<strong>1人あたりの年間人件費</strong>（賃金+賞与+福利厚生）<br>' +
            '・各工程で使う<strong>設備の年間費用</strong>（リース料・減価償却費）' +
            (isLv4 ? '<br>・機械主体の工程：<strong>設備台数</strong>と<strong>1台あたり稼働時間</strong>' : '') + '</div>'
        },
        {
          title: "工程の情報を入力",
          html: '<p style="font-size:14px;line-height:1.8;margin-bottom:12px">登録する工程の情報を入力してください。</p>' +
            '<div class="form-grid" style="max-width:400px">' +
            '<label>工程名</label><input type="text" id="sg-dept-name" placeholder="例: シート加工">' +
            '<label>直接作業者数</label><input type="number" id="sg-dept-workers" class="input-num" step="1" value="0">' +
            '<label>1人あたり年間人件費(円)</label><input type="number" id="sg-dept-labor" class="input-num" step="1" value="3500000">' +
            '<label>標準機械装置費用(年/円)</label><input type="number" id="sg-dept-machine" class="input-num" step="1" value="0">' +
            machineFields +
            '</div>' +
            '<div class="help-example" style="margin-top:12px;padding:8px 12px;background:var(--bg);border-radius:6px;font-size:12px">' +
            '人件費の目安：正社員1人あたり300〜450万円/年（賃金+賞与+福利厚生）<br>' +
            '機械装置費用：その工程で使う設備のリース料や減価償却費の年間合計' + machineHelp + '</div>'
        },
        {
          title: "登録完了！",
          html: '<div style="text-align:center;padding:20px 0">' +
            '<div style="font-size:40px;margin-bottom:12px">🏭</div>' +
            '<p style="font-size:16px;font-weight:600;margin-bottom:8px">工程を登録しました</p>' +
            '<p style="font-size:14px;color:var(--text-muted);line-height:1.8">続けて他の工程も「+ 部門追加」または「📝 ガイド付きで追加する」から登録してください。<br>全工程の登録が終わったら「製品原価」タブへ進みます。</p>' +
            '</div>'
        }
      ];
    }

    // 製品ガイドのステップ（動的生成）
    function buildProductSteps() {
      var data = loadData();
      var freightOn = data.companySettings.enable_freight_cost;
      var freightField = freightOn
        ? '<label>直接運送費(円/個)</label><input type="number" id="sg-prod-freight" class="input-num" step="1" value="0">'
        : '';
      return [
        {
          title: "製品を登録しましょう",
          html: '<p style="font-size:14px;line-height:1.8;margin-bottom:12px">原価を分析したい製品を登録します。全製品を入れる必要はありません。重要度の高い製品から始めてください。</p>' +
            '<div style="background:var(--bg);border-radius:6px;padding:12px 16px;font-size:13px;line-height:2">' +
            '<strong>準備するもの：</strong><br>' +
            '・製品の<strong>販売価格</strong>（1個あたり）<br>' +
            '・<strong>材料費</strong>（1個あたりの主要材料費）<br>' +
            '・<strong>外注費</strong>（外注加工がある場合）<br>' +
            (freightOn ? '・<strong>直接運送費</strong>（1個あたりの運送費）<br>' : '') +
            '・各工程での<strong>作業時間</strong>（1個あたり、時間単位）</div>'
        },
        {
          title: "製品の基本情報を入力",
          html: '<p style="font-size:14px;line-height:1.8;margin-bottom:12px">原価を分析したい製品の情報を入力してください。</p>' +
            '<div class="form-grid" style="max-width:400px">' +
            '<label>製品コード</label><input type="text" id="sg-prod-code" placeholder="例: A">' +
            '<label>製品名</label><input type="text" id="sg-prod-name" placeholder="例: 製品A">' +
            '<label>目標販売価格(円)</label><input type="number" id="sg-prod-price" class="input-num" step="1" value="0">' +
            '<label>直接材料費(円/個)</label><input type="number" id="sg-prod-material" class="input-num" step="1" value="0">' +
            '<label>直接外注費(円/個)</label><input type="number" id="sg-prod-outsource" class="input-num" step="1" value="0">' +
            freightField +
            '</div>' +
            '<div class="help-example" style="margin-top:12px;padding:8px 12px;background:var(--bg);border-radius:6px;font-size:12px">' +
            '材料費：この製品1個に使う材料の合計金額<br>' +
            '外注費：メッキ・熱処理など外部委託の費用（なければ0）<br>' +
            '工程の作業時間は登録後に「製造ルーティング」で設定します</div>'
        },
        {
          title: "登録完了！",
          html: '<div style="text-align:center;padding:20px 0">' +
            '<div style="font-size:40px;margin-bottom:12px">📊</div>' +
            '<p style="font-size:16px;font-weight:600;margin-bottom:8px">製品を登録しました</p>' +
            '<p style="font-size:14px;color:var(--text-muted);line-height:1.8">製品カードの「製造ルーティング」で各工程の作業時間を設定すると、原価と利益が自動計算されます。<br>「+ 工程追加」ボタンで工程を追加し、作業時間(h/個)を入力してください。</p>' +
            '</div>'
        }
      ];
    }

    function startGuide(guideSteps, onSave) {
      var localStep = 0;
      function show(idx) {
        localStep = idx;
        titleEl.textContent = guideSteps[idx].title;
        progressEl.textContent = (idx + 1) + " / " + guideSteps.length;
        contentEl.innerHTML = guideSteps[idx].html;
        prevBtn.style.display = idx === 0 ? "none" : "";
        nextBtn.textContent = idx === guideSteps.length - 1 ? "完了" : "次へ";
      }
      prevBtn.onclick = function() { if (localStep > 0) show(localStep - 1); };
      nextBtn.onclick = function() {
        if (onSave) onSave(localStep);
        if (localStep < guideSteps.length - 1) {
          show(localStep + 1);
        } else {
          modal.style.display = "none";
          reloadAll();
        }
      };
      show(0);
      modal.style.display = "";
    }

    // ボタンのイベント登録
    var baseGuideBtn = document.getElementById("btn-base-guide");
    if (baseGuideBtn) baseGuideBtn.addEventListener("click", function() {
      startGuide(steps, function(step) {
        if (step === 1) {
          var data = loadData();
          data.plData.sales = parseFloat(document.getElementById("sg-pl-sales").value) || 0;
          data.plData.sga_total = parseFloat(document.getElementById("sg-pl-sga").value) || 0;
          saveData(data);
        } else if (step === 2) {
          var data = loadData();
          data.mcrData.material_cost = parseFloat(document.getElementById("sg-mcr-mat").value) || 0;
          data.mcrData.labor_wages = parseFloat(document.getElementById("sg-mcr-labor").value) || 0;
          data.mcrData.outsourcing_cost = parseFloat(document.getElementById("sg-mcr-out").value) || 0;
          data.mcrData.exp_depreciation = parseFloat(document.getElementById("sg-mcr-exp").value) || 0;
          saveData(data);
        } else if (step === 3) {
          var data = loadData();
          data.companySettings.common_working_hours = parseInt(document.getElementById("sg-hours").value) || 1800;
          saveData(data);
        }
      });
    });

    var deptGuideBtn = document.getElementById("btn-dept-guide");
    if (deptGuideBtn) deptGuideBtn.addEventListener("click", function() {
      startGuide(buildDeptSteps(), function(step) {
        if (step === 1) {
          var name = (document.getElementById("sg-dept-name").value || "").trim();
          if (!name) return;
          var workers = parseInt(document.getElementById("sg-dept-workers").value) || 0;
          var laborPer = parseFloat(document.getElementById("sg-dept-labor").value) || 0;
          var machine = parseFloat(document.getElementById("sg-dept-machine").value) || 0;
          var data = loadData();
          data.departments.push({
            id: nextId(data.departments),
            department_name: name,
            worker_count: workers,
            labor_cost_per_person: laborPer,
            annual_labor_cost: workers * laborPer,
            allocation_base_type: "operating_hours",
            allocation_base_value: 0,
            is_machine_based: document.getElementById("sg-dept-machine-based") ? document.getElementById("sg-dept-machine-based").value === "true" : false,
            standard_machine_cost: machine,
            machine_count: document.getElementById("sg-dept-machine-count") ? parseInt(document.getElementById("sg-dept-machine-count").value) || 0 : 0,
            machine_operating_hours: document.getElementById("sg-dept-machine-hours") ? parseInt(document.getElementById("sg-dept-machine-hours").value) || 0 : 0
          });
          saveData(data);
          showToast("部門「" + name + "」を登録しました", "success");
        }
      });
    });

    var prodGuideBtn = document.getElementById("btn-product-guide");
    if (prodGuideBtn) prodGuideBtn.addEventListener("click", function() {
      startGuide(buildProductSteps(), function(step) {
        if (step === 1) {
          var name = (document.getElementById("sg-prod-name").value || "").trim();
          if (!name) return;
          var freightEl = document.getElementById("sg-prod-freight");
          var data = loadData();
          data.products.push({
            id: nextId(data.products),
            product_code: document.getElementById("sg-prod-code").value || "",
            product_name: name,
            target_sales_price: parseFloat(document.getElementById("sg-prod-price").value) || 0,
            direct_material_cost: parseFloat(document.getElementById("sg-prod-material").value) || 0,
            direct_outsourcing_cost: parseFloat(document.getElementById("sg-prod-outsource").value) || 0,
            special_direct_expense: freightEl ? parseFloat(freightEl.value) || 0 : 0,
            routings: []
          });
          saveData(data);
          showToast("製品「" + name + "」を登録しました", "success");
        }
      });
    });

    // 公開（オンボーディングから呼び出す）
    window.CostApp.startStepGuide = function() {
      startGuide(steps, function(step) {
        if (step === 1) {
          var data = loadData();
          data.plData.sales = parseFloat(document.getElementById("sg-pl-sales").value) || 0;
          data.plData.sga_total = parseFloat(document.getElementById("sg-pl-sga").value) || 0;
          saveData(data);
        } else if (step === 2) {
          var data = loadData();
          data.mcrData.material_cost = parseFloat(document.getElementById("sg-mcr-mat").value) || 0;
          data.mcrData.labor_wages = parseFloat(document.getElementById("sg-mcr-labor").value) || 0;
          data.mcrData.outsourcing_cost = parseFloat(document.getElementById("sg-mcr-out").value) || 0;
          data.mcrData.exp_depreciation = parseFloat(document.getElementById("sg-mcr-exp").value) || 0;
          saveData(data);
        } else if (step === 3) {
          var data = loadData();
          data.companySettings.common_working_hours = parseInt(document.getElementById("sg-hours").value) || 1800;
          saveData(data);
        }
      });
    };
  }

  // ══ ヘルプアイコン ══
  var helpData = {
    "cs-common-working-hours": {
      title: "共通年間労働時間",
      text: "1人あたりの年間稼働時間です。有給休暇や休日を除いた実働時間を入力します。",
      example: "年間250日勤務 × 7.2時間/日 = 1,800時間"
    },
    "cs-alloc-type": {
      title: "製造間接費の配賦",
      text: "製造間接費を各部門に配分する基準です。稼働時間比が最も一般的です。",
      example: "稼働時間比：稼働時間が長い部門ほど多くの間接費を負担<br>直接原価比：直接原価が大きい部門ほど多く負担"
    },
    "pl-sales": {
      title: "売上高",
      text: "損益計算書の売上高をそのまま千円単位で入力します。",
      example: "決算書の売上高が14億2,500万円 → 1425000"
    },
    "pl-sga-total": {
      title: "販管費",
      text: "販売費及び一般管理費の合計を千円単位で入力します。営業人件費・事務所費・広告費等が含まれます。",
      example: "決算書の販管費合計が8,841万円 → 88410"
    },
    "mcr-material": {
      title: "材料費",
      text: "製造原価報告書の材料費をそのまま入力します。主要材料・補助材料・買入部品等の合計です。",
      example: "決算書の材料費が6億1,317万円 → 613170"
    },
    "mcr-outsourcing": {
      title: "外注加工費",
      text: "製造原価報告書の外注加工費をそのまま入力します。自社で行わず外部に委託した加工費用です。",
      example: "メッキ処理や熱処理の外注費"
    },
    "mcr-depreciation": {
      title: "減価償却費",
      text: "部門の「標準機械装置費用」に含めていない建物・共用設備等の減価償却費のみを入力します。部門に直接計上した設備の分を含めると二重計上になります。",
      example: "決算書の償却費5,000万円 − 部門計上分3,500万円 = 1,500万円 → 15000"
    },
    "split-material-ratio": {
      title: "材料費 直接費率",
      text: "製造原価報告書の材料費のうち、製品に直接使用される主要材料の割合です。間接材料（消耗品的な材料）がある場合は100%未満にします。",
      example: "材料費のほぼ全額が主要材料 → 100%<br>間接材料が1割程度 → 90%"
    }
  };

  function initHelpIcons() {
    var popup = null;
    for (var id in helpData) {
      var el = document.getElementById(id);
      if (!el) continue;
      var label = el.previousElementSibling;
      if (!label || label.tagName !== "LABEL") {
        // selectの場合、前のlabelを探す
        var prev = el;
        while (prev && prev.tagName !== "LABEL") prev = prev.previousElementSibling;
        label = prev;
      }
      if (!label) continue;
      var icon = document.createElement("span");
      icon.className = "help-icon";
      icon.textContent = "?";
      icon.dataset.helpId = id;
      label.appendChild(icon);
    }

    document.addEventListener("click", function(e) {
      var icon = e.target.closest(".help-icon");
      if (popup) { popup.remove(); popup = null; }
      if (!icon) return;

      var data = helpData[icon.dataset.helpId];
      if (!data) return;

      popup = document.createElement("div");
      popup.className = "help-popup";
      popup.innerHTML = '<strong>' + data.title + '</strong>' + data.text +
        (data.example ? '<div class="help-example">' + data.example + '</div>' : '');

      document.body.appendChild(popup);
      var rect = icon.getBoundingClientRect();
      popup.style.top = Math.min(rect.bottom + 6, window.innerHeight - popup.offsetHeight - 10) + "px";
      popup.style.left = Math.min(rect.left, window.innerWidth - popup.offsetWidth - 10) + "px";
    });
  }

  // ══ 初期化 ══
  document.addEventListener("DOMContentLoaded", function() {
    initTabs();
    initHeaderActions();
    initLevelSelector();
    initFreightToggle();
    initEscapeKey();
    initLevelWizard();
    initHelpIcons();
    initStepGuide();

    if (window.CostApp.baseData) window.CostApp.baseData.init();
    if (window.CostApp.deptCost) window.CostApp.deptCost.init();
    if (window.CostApp.productCost) window.CostApp.productCost.init();

    initCoverPage();
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
