(function(app) {
  "use strict";

  // ════════════════════════════════════════════════════
  //  Excel出力
  // ════════════════════════════════════════════════════

  function exportExcel() {
    var data = app.loadData();
    var cs = data.companySettings;
    var level = cs.calc_level || 1;
    var wb = XLSX.utils.book_new();

    // ── Sheet 1: 全社設定 ──
    buildSettingsSheet(wb, data, cs);

    // ── Sheet 2: 部門・レート ──
    buildDeptSheet(wb, data, cs, level);

    // ── Sheet 3: 製品原価比較 ──
    buildProductCompareSheet(wb, data, cs, level);

    // ── Sheet 4: 製品原価詳細 ──
    buildProductDetailSheet(wb, data, cs, level);

    // ダウンロード
    var name = (cs.setting_name || "原価シミュレーション").replace(/[\/\\?*[\]]/g, "_");
    XLSX.writeFile(wb, name + ".xlsx");
    app.showToast("Excelファイルを出力しました", "success");
  }

  function buildSettingsSheet(wb, data, cs) {
    var levelNames = { 1: "方式1: 簡易方式", 2: "方式2: 全社統一(D/I分離)", 3: "方式3: 部門別(人手主体)", 4: "方式4: 部門別(機械混在)" };
    var allocNames = { worker_count: "人数比", area: "面積比", manual: "手動" };
    var mcr = data.mcrData || {};
    var pl = data.plData || {};

    var rows = [
      ["製品原価シミュレーション - 全社設定"],
      [],
      ["■ 基本設定"],
      ["対象年度・名称", cs.setting_name || ""],
      ["原価計算方式", levelNames[cs.calc_level] || ""],
      ["共通年間労働時間(h)", cs.common_working_hours || 0],
      ["間接費配賦基準", allocNames[cs.allocation_base_type] || "人数比"],
      ["運送費配賦", cs.enable_freight_cost ? "ON" : "OFF"],
      [],
      ["■ 間接費（自動計算）"],
      ["製造間接費(円)", cs.mfg_indirect_expenses || 0],
      ["販管費(円)", cs.sga_indirect_expenses || 0],
      ["間接費合計(円)", cs.common_indirect_expenses || 0],
      [],
      ["■ 損益計算書（P&L）（千円）"],
      ["売上高", pl.sales || 0],
      ["販管費", pl.sga_total || 0],
      ["うち運送費", pl.sga_shipping || 0],
      [],
      ["■ 製造原価報告書（千円）"],
      ["材料費", mcr.material_cost || 0],
      ["賃金", mcr.labor_wages || 0],
      ["賞与", mcr.labor_bonus || 0],
      ["福利厚生費", mcr.labor_welfare || 0],
      ["外注加工費", mcr.outsourcing_cost || 0],
      ["減価償却費", mcr.exp_depreciation || 0],
      ["消耗品費", mcr.exp_consumables || 0],
      ["修繕費", mcr.exp_repairs || 0],
      ["リース料", mcr.exp_lease || 0],
      ["電力費", mcr.exp_utilities || 0],
      ["租税公課", mcr.exp_taxes || 0],
      ["地代家賃", mcr.exp_rent || 0],
      ["その他", mcr.exp_other || 0]
    ];

    // MCR合計
    var mcrTotal = 0;
    ["material_cost","labor_wages","labor_bonus","labor_welfare","outsourcing_cost",
     "exp_depreciation","exp_consumables","exp_repairs","exp_lease","exp_utilities",
     "exp_taxes","exp_rent","exp_other"].forEach(function(k) { mcrTotal += (mcr[k] || 0); });
    rows.push(["製造原価合計", mcrTotal]);

    var ws = XLSX.utils.aoa_to_sheet(rows);
    // 列幅設定
    ws["!cols"] = [{ wch: 22 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, "全社設定");
  }

  function buildDeptSheet(wb, data, cs, level) {
    var depts = data.departments || [];
    if (!depts.length) return;

    var allowMachine = (level === 4);
    var rates = app.calcEngine.calcDeptRatesLv3(cs, depts, allowMachine);
    var lv1 = app.calcEngine.calcLv1Rate(cs, depts);

    var rows = [
      ["製品原価シミュレーション - 部門・レート一覧"],
      [],
      ["部門名", "作業者数", "年間人件費(円)", "機械装置費用(円/年)", "稼働形態",
       "直接原価(円)", "間接費(円)", "総費用(円)", "稼働時間(h)",
       "直接レート(円/h)", "間接レート(円/h)", "総レート(円/h)"]
    ];

    rates.forEach(function(r) {
      var d = r.dept;
      rows.push([
        d.department_name,
        d.worker_count || 0,
        d.annual_labor_cost || 0,
        d.standard_machine_cost || 0,
        (level >= 4 && d.is_machine_based) ? "機械主体" : "人手主体",
        Math.round(r.directCost),
        Math.round(r.allocatedIndirect),
        Math.round(r.totalCost),
        Math.round(r.operatingHours),
        Math.round(r.directHourlyRate),
        Math.round(r.indirectHourlyRate),
        Math.round(r.hourlyRate)
      ]);
    });

    // 全社統一レート行
    if (level <= 2) {
      rows.push([
        "★ 全社統一",
        "", "", "", "",
        Math.round(lv1.totalDirectCost),
        Math.round(lv1.totalIndirect),
        Math.round(lv1.totalDirectCost + lv1.totalIndirect),
        Math.round(lv1.totalHours),
        Math.round(lv1.directHourlyRate),
        Math.round(lv1.indirectHourlyRate),
        Math.round(lv1.hourlyRate)
      ]);
    }

    var ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [
      { wch: 16 }, { wch: 8 }, { wch: 16 }, { wch: 16 }, { wch: 10 },
      { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 },
      { wch: 14 }, { wch: 14 }, { wch: 14 }
    ];
    XLSX.utils.book_append_sheet(wb, ws, "部門・レート");
  }

  function buildProductCompareSheet(wb, data, cs, level) {
    var products = data.products || [];
    if (!products.length) return;

    var depts = data.departments || [];
    var deptRates = [];
    var lv1Rate = null;
    if (level <= 2) {
      lv1Rate = app.calcEngine.calcLv1Rate(cs, depts);
    } else {
      deptRates = app.calcEngine.calcDeptRatesLv3(cs, depts, level === 4);
    }

    var rows = [
      ["製品原価シミュレーション - 製品原価比較"],
      [],
      ["製品", "直接材料費", "直接加工費", "直接外注費", "直接原価計",
       "製造間接費", "製造原価", "販管費", "総原価",
       "販売価格", "限界利益率(%)", "製造利益率(%)", "営業利益率(%)"]
    ];

    products.forEach(function(p) {
      var c;
      if (level <= 2) {
        c = app.calcEngine.calcProductCostLv1(p, lv1Rate, cs, depts);
      } else {
        c = app.calcEngine.calcProductCost(p, deptRates, cs, level);
      }
      enrichCostResult(c, cs);

      rows.push([
        (p.product_code || "") + " " + (p.product_name || ""),
        Math.round(c.materialCost),
        Math.round(c.totalDirectProcess || 0),
        Math.round(c.outsourcingCost),
        Math.round(c.directCostTotal || 0),
        Math.round(c.mfgIndirectProcess || 0),
        Math.round(c.manufacturingCost || 0),
        Math.round(c.sgaIndirectProcess || 0),
        Math.round(c.totalCost),
        Math.round(c.sellingPrice),
        Math.round((c.marginalProfitRate || 0) * 10) / 10,
        Math.round((c.manufacturingProfitRate || 0) * 10) / 10,
        Math.round((c.operatingProfitRate || 0) * 10) / 10
      ]);
    });

    var ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [
      { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }
    ];
    XLSX.utils.book_append_sheet(wb, ws, "製品原価比較");
  }

  function buildProductDetailSheet(wb, data, cs, level) {
    var products = data.products || [];
    if (!products.length) return;

    var depts = data.departments || [];
    var deptRates = [];
    var lv1Rate = null;
    if (level <= 2) {
      lv1Rate = app.calcEngine.calcLv1Rate(cs, depts);
    } else {
      deptRates = app.calcEngine.calcDeptRatesLv3(cs, depts, level === 4);
    }

    var rows = [
      ["製品原価シミュレーション - 製品原価詳細"]
    ];

    products.forEach(function(p, pi) {
      var c;
      if (level <= 2) {
        c = app.calcEngine.calcProductCostLv1(p, lv1Rate, cs, depts);
      } else {
        c = app.calcEngine.calcProductCost(p, deptRates, cs, level);
      }
      enrichCostResult(c, cs);

      rows.push([]);
      rows.push(["■ " + (p.product_code || "") + " " + (p.product_name || "")]);
      rows.push(["目標販売価格(円)", Math.round(c.sellingPrice)]);
      rows.push([]);

      // ルーティング
      rows.push(["工順", "工程", "作業時間(h)", "直接レート(円/h)", "間接レート(円/h)", "加工費(円)"]);
      (c.routingDetails || []).forEach(function(rd) {
        rows.push([
          rd.process_order,
          rd.dept_name,
          rd.working_hours,
          rd.directHourlyRate !== undefined ? Math.round(rd.directHourlyRate) : Math.round(rd.hourlyRate),
          rd.indirectHourlyRate !== undefined ? Math.round(rd.indirectHourlyRate) : "",
          Math.round(rd.cost)
        ]);
      });

      rows.push([]);
      rows.push(["原価項目", "金額(円)"]);
      rows.push(["直接材料費", Math.round(c.materialCost)]);
      rows.push(["直接加工費", Math.round(c.totalDirectProcess || 0)]);
      if (c.outsourcingCost > 0) rows.push(["直接外注費", Math.round(c.outsourcingCost)]);
      if (c.specialExpense > 0) rows.push(["特約運送費・直課経費", Math.round(c.specialExpense)]);
      if (c.freightCost > 0) rows.push(["運送費（配賦）", Math.round(c.freightCost)]);
      rows.push(["▶ 直接原価", Math.round(c.directCostTotal || 0)]);
      rows.push(["＋ 製造間接費", Math.round(c.mfgIndirectProcess || 0)]);
      rows.push(["▶ 製造原価", Math.round(c.manufacturingCost || 0)]);
      rows.push(["＋ 販管費", Math.round(c.sgaIndirectProcess || 0)]);
      rows.push(["▶ 総原価", Math.round(c.totalCost)]);
      rows.push([]);
      rows.push(["限界利益", Math.round(c.marginalProfit || 0), (c.marginalProfitRate || 0).toFixed(1) + "%"]);
      rows.push(["製造利益", Math.round(c.manufacturingProfit || 0), (c.manufacturingProfitRate || 0).toFixed(1) + "%"]);
      rows.push(["営業利益", Math.round(c.operatingProfit), (c.operatingProfitRate || 0).toFixed(1) + "%"]);
    });

    var ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 22 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, "製品原価詳細");
  }

  // enrichCostResult (product-cost.js と同じロジック)
  function enrichCostResult(cost, cs) {
    var mfg = Math.max(0, cs.mfg_indirect_expenses || 0);
    var sga = Math.max(0, cs.sga_indirect_expenses || 0);
    var sum = mfg + sga;
    var mfgRatio = sum > 0 ? mfg / sum : 0;

    var totalIndirect = cost.totalIndirectProcess || 0;
    cost.mfgIndirectProcess = totalIndirect * mfgRatio;
    cost.sgaIndirectProcess = totalIndirect - cost.mfgIndirectProcess;
    cost.manufacturingCost = (cost.directCostTotal || 0) + cost.mfgIndirectProcess;
    cost.manufacturingProfit = (cost.sellingPrice || 0) - cost.manufacturingCost;
    cost.manufacturingProfitRate = cost.sellingPrice > 0 ? cost.manufacturingProfit / cost.sellingPrice * 100 : 0;
    return cost;
  }

  // ════════════════════════════════════════════════════
  //  PDF出力（セクション単位で改ページ制御）
  // ════════════════════════════════════════════════════

  function exportPdf() {
    app.showToast("PDF生成中...", "info");

    // 全タブを一時的に表示してキャプチャ
    var panels = document.querySelectorAll(".tab-panel");
    var originalStates = [];
    panels.forEach(function(p) {
      originalStates.push({ el: p, display: p.style.display, className: p.className });
      p.classList.add("active");
      p.style.display = "block";
    });

    // モーダル・保存ボタンを隠す
    var modal = document.getElementById("dept-modal");
    var modalWasVisible = modal.style.display !== "none";
    modal.style.display = "none";

    setTimeout(function() {
      var jsPDF = window.jspdf.jsPDF;
      var pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      var pageW = pdf.internal.pageSize.getWidth();   // ~297
      var pageH = pdf.internal.pageSize.getHeight();  // ~210
      var margin = 10;
      var contentW = pageW - margin * 2;
      var usableH = pageH - margin * 2;
      var currentY = margin;
      var gap = 3; // セクション間の余白(mm)
      var isFirstTab = true;

      // ── 表示中の要素かどうか判定 ──
      function isVisible(el) {
        if (!el || el.offsetHeight <= 0) return false;
        var style = getComputedStyle(el);
        return style.display !== "none" && el.style.display !== "none";
      }

      // ── 各タブからキャプチャ対象セクションを収集 ──
      var sections = [];
      var tabConfigs = [
        { id: "tab-base", title: "全社設定" },
        { id: "tab-dept", title: "部門（工程）" },
        { id: "tab-product", title: "製品原価" }
      ];

      tabConfigs.forEach(function(cfg) {
        sections.push({ type: "tab-break" });
        var tab = document.getElementById(cfg.id);
        var children = tab.children;
        for (var i = 0; i < children.length; i++) {
          var child = children[i];
          if (!isVisible(child)) continue;
          // ツールバー・保存ボタンはPDFに含めない
          if (child.classList.contains("toolbar") || child.classList.contains("panel-actions")) continue;

          // 部門コンテナは個別カードに分解
          if (child.id === "dept-container") {
            for (var j = 0; j < child.children.length; j++) {
              if (isVisible(child.children[j])) {
                sections.push({ type: "element", el: child.children[j] });
              }
            }
          }
          // 製品コンテナ: 1製品 = 1ページ（改ページ + カード全体）
          else if (child.id === "product-container") {
            for (var j = 0; j < child.children.length; j++) {
              var productCard = child.children[j];
              if (!isVisible(productCard)) continue;
              sections.push({ type: "product-break" }); // 製品ごとに改ページ
              sections.push({ type: "element", el: productCard });
            }
          } else {
            sections.push({ type: "element", el: child });
          }
        }
      });

      // ── セクションを順にキャプチャしてPDFに配置 ──
      var idx = 0;

      function processNext() {
        if (idx >= sections.length) {
          finish();
          return;
        }
        var s = sections[idx++];

        // タブ区切り: 新しいページから開始
        if (s.type === "tab-break") {
          if (!isFirstTab) {
            pdf.addPage();
            currentY = margin;
          }
          isFirstTab = false;
          processNext();
          return;
        }

        // 製品区切り: 必ず新しいページから開始
        if (s.type === "product-break") {
          pdf.addPage();
          currentY = margin;
          processNext();
          return;
        }

        // 要素をhtml2canvasでキャプチャ
        html2canvas(s.el, {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: "#f8fafc"
        }).then(function(canvas) {
          if (canvas.width === 0 || canvas.height === 0) {
            processNext();
            return;
          }

          var imgW = contentW;
          var imgH = (canvas.height / canvas.width) * imgW;

          if (imgH <= usableH) {
            // ━━ 1ページに収まるセクション ━━
            // 現在のページに入りきらなければ改ページ
            if (currentY + imgH > pageH - margin) {
              pdf.addPage();
              currentY = margin;
            }
            var imgData = canvas.toDataURL("image/jpeg", 0.92);
            pdf.addImage(imgData, "JPEG", margin, currentY, imgW, imgH);
            currentY += imgH + gap;
          } else {
            // ━━ 1ページに収まらない大きなセクション（テーブル等）━━
            // ページの途中だったら新ページから開始
            if (currentY > margin + 1) {
              pdf.addPage();
              currentY = margin;
            }
            splitLargeSection(pdf, canvas, imgW);
          }

          processNext();
        }).catch(function() {
          processNext(); // キャプチャ失敗はスキップ
        });
      }

      // ── 大きなセクションを複数ページに分割 ──
      function splitLargeSection(pdf, canvas, imgW) {
        var ratio = canvas.width / imgW;
        var sliceMaxCanvasH = usableH * ratio;
        var srcY = 0;
        var remaining = canvas.height;
        var first = true;

        while (remaining > 0) {
          if (!first) {
            pdf.addPage();
            currentY = margin;
          }
          first = false;

          var sliceH = Math.min(remaining, sliceMaxCanvasH);
          var tmpCanvas = document.createElement("canvas");
          tmpCanvas.width = canvas.width;
          tmpCanvas.height = sliceH;
          tmpCanvas.getContext("2d").drawImage(
            canvas, 0, srcY, canvas.width, sliceH,
            0, 0, canvas.width, sliceH
          );

          var sliceData = tmpCanvas.toDataURL("image/jpeg", 0.92);
          var sliceImgH = sliceH / ratio;
          pdf.addImage(sliceData, "JPEG", margin, currentY, imgW, sliceImgH);
          currentY += sliceImgH + gap;

          srcY += sliceH;
          remaining -= sliceH;
        }
      }

      // ── 完了処理 ──
      function finish() {
        // タブの表示状態を元に戻す
        panels.forEach(function(p, i) {
          p.style.display = originalStates[i].display;
          p.className = originalStates[i].className;
        });
        if (modalWasVisible) modal.style.display = "grid";

        var cs = app.loadData().companySettings;
        var name = (cs.setting_name || "原価シミュレーション").replace(/[\/\\?*[\]]/g, "_");
        pdf.save(name + ".pdf");
        app.showToast("PDFファイルを出力しました", "success");
      }

      processNext();
    }, 300);
  }

  // ════════════════════════════════════════════════════
  //  初期化
  // ════════════════════════════════════════════════════

  function init() {
    var btnExcel = document.getElementById("btn-export-excel");
    var btnPdf = document.getElementById("btn-export-pdf");
    if (btnExcel) btnExcel.addEventListener("click", exportExcel);
    if (btnPdf) btnPdf.addEventListener("click", exportPdf);
  }

  document.addEventListener("DOMContentLoaded", init);

  app.exportUtil = { exportExcel: exportExcel, exportPdf: exportPdf };

})(window.CostApp);
