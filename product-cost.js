(function(app) {
  "use strict";

  function init() {
    document.getElementById("btn-add-product").addEventListener("click", addProduct);
    load();
    app.onTabSwitch("tab-product", load);
  }

  function load() {
    var data = app.loadData();
    renderProducts(data);
  }

  /**
   * 製造間接費/販管費の比率を取得
   * @returns {{ mfgRatio: number, sgaRatio: number }}
   */
  function getMfgSgaRatio(cs) {
    var mfg = Math.max(0, cs.mfg_indirect_expenses || 0);
    var sga = Math.max(0, cs.sga_indirect_expenses || 0);
    var sum = mfg + sga;
    if (sum <= 0) return { mfgRatio: 0, sgaRatio: 0 };
    return { mfgRatio: mfg / sum, sgaRatio: sga / sum };
  }

  /**
   * 製品原価結果に製造利益を追加
   */
  function enrichCostResult(cost, cs) {
    var ratio = getMfgSgaRatio(cs);
    var totalIndirect = cost.totalIndirectProcess || 0;
    cost.mfgIndirectProcess = totalIndirect * ratio.mfgRatio;
    cost.sgaIndirectProcess = totalIndirect - cost.mfgIndirectProcess;
    cost.manufacturingCost = (cost.directCostTotal || 0) + cost.mfgIndirectProcess;
    cost.manufacturingProfit = (cost.sellingPrice || 0) - cost.manufacturingCost;
    cost.manufacturingProfitRate = cost.sellingPrice > 0 ? cost.manufacturingProfit / cost.sellingPrice * 100 : 0;
    return cost;
  }

  function renderProducts(data) {
    var container = document.getElementById("product-container");
    var products = data.products || [];
    var cs = data.companySettings;
    var level = cs.calc_level || 1;
    var departments = data.departments || [];

    if (!products.length) {
      container.innerHTML = '<p class="text-muted text-center" style="padding:20px">製品が登録されていません。「+ 製品追加」ボタンで追加してください。</p>';
      document.getElementById("product-compare").style.display = "none";
      return;
    }

    // レート計算
    var deptRates = [];
    var lv1Rate = null;
    if (level <= 2) {
      lv1Rate = app.calcEngine.calcLv1Rate(cs, departments);
    } else {
      var allowMachine = (level === 4);
      deptRates = app.calcEngine.calcDeptRatesLv3(cs, departments, allowMachine);
    }

    container.innerHTML = products.map(function(p, idx) {
      return renderProductCard(p, idx, departments, deptRates, lv1Rate, cs, level);
    }).join("");

    // イベント登録
    container.querySelectorAll(".product-card").forEach(function(card, idx) {
      bindProductEvents(card, idx, data);
    });

    // 比較ダッシュボード
    renderCompareTable(products, departments, deptRates, lv1Rate, cs, level);
  }

  function renderProductCard(p, idx, departments, deptRates, lv1Rate, cs, level) {
    var cost;
    if (level <= 2) {
      cost = app.calcEngine.calcProductCostLv1(p, lv1Rate, cs, departments, level);
    } else {
      cost = app.calcEngine.calcProductCost(p, deptRates, cs, level);
    }
    enrichCostResult(cost, cs);

    var html = '<div class="product-card" data-idx="' + idx + '">';

    // ヘッダー
    html += '<div class="product-card-header">';
    html += '<h3>' + app.escHtml(p.product_code || "") + ' ' + app.escHtml(p.product_name) + '</h3>';
    html += '<div>';
    html += '<button class="btn btn-sm prod-save" data-idx="' + idx + '">保存</button> ';
    html += '<button class="btn-sm text-danger prod-delete" data-idx="' + idx + '" title="この製品を削除">削除</button>';
    html += '</div>';
    html += '</div>';

    // 基本情報
    html += '<div class="form-grid four-col">';
    html += '<label>製品コード</label><input type="text" class="pf-code" value="' + app.escHtml(p.product_code || "") + '">';
    html += '<label>製品名 *</label><input type="text" class="pf-name" value="' + app.escHtml(p.product_name || "") + '">';
    html += '<label>目標販売価格(円)</label><input type="number" class="pf-price input-num" value="' + (p.target_sales_price || 0) + '">';
    html += '<label>直接材料費(円/個) *</label><input type="number" class="pf-material input-num" value="' + (p.direct_material_cost || 0) + '">';
    html += '<label>直接外注費(円/個)</label><input type="number" class="pf-outsource input-num" value="' + (p.direct_outsourcing_cost || 0) + '">';
    html += '<label>直接運送費(円)</label><input type="number" class="pf-special input-num" value="' + (p.special_direct_expense || 0) + '">';
    html += '</div>';

    // ルーティングテーブル
    html += '<h3 style="margin-top:12px">製造ルーティング</h3>';
    html += '<table class="data-table compact">';

    if (level === 1) {
      html += '<thead><tr><th>工順</th><th>工程</th><th>作業時間(h/個)</th><th>レート(円/h)</th><th>加工費</th><th>削除</th></tr></thead>';
    } else {
      html += '<thead><tr><th>工順</th><th>工程</th><th>作業時間(h/個)</th><th>直接レート</th><th>間接レート</th><th>加工費合計</th><th>削除</th></tr></thead>';
    }

    html += '<tbody class="routing-tbody">';
    (p.routings || []).forEach(function(rt, ri) {
      html += renderRoutingRow(rt, ri, departments, deptRates, lv1Rate, level);
    });
    html += '</tbody></table>';
    html += '<button class="btn btn-sm rt-add" data-idx="' + idx + '" style="margin-top:4px">+ 工程追加</button>';

    // ── 原価結果 ──
    html += '<div class="cost-result">';

    // ── 原価内訳 ──
    html += '<div class="cost-line"><span>' + (level === 1 ? '材料費' : '直接材料費') + '</span><span>' + app.formatYen(cost.materialCost) + ' 円</span></div>';

    cost.routingDetails.forEach(function(rd) {
      html += '<div class="cost-line"><span>' + app.escHtml(rd.dept_name) + ' (' + rd.working_hours.toFixed(4) + 'h)</span><span>' + app.formatYen(rd.cost) + ' 円</span></div>';
    });

    if (cost.outsourcingCost > 0) {
      html += '<div class="cost-line"><span>' + (level === 1 ? '外注費' : '直接外注費') + '</span><span>' + app.formatYen(cost.outsourcingCost) + ' 円</span></div>';
    }
    if (cost.specialExpense > 0) {
      html += '<div class="cost-line"><span>直接運送費</span><span>' + app.formatYen(cost.specialExpense) + ' 円</span></div>';
    }

    if (level === 1) {
      // ── 方式1: 総原価のみ（直間分離なし） ──
      html += '<div class="cost-line cost-total"><span>▶ 総原価</span><span>' + app.formatYen(cost.totalCost) + ' 円</span></div>';

      // ── 営業利益のみ ──
      var opClass = cost.operatingProfit >= 0 ? "profit-positive" : "profit-negative";
      html += '<div class="profit-box operating" style="margin-top:8px"><div class="profit-label">営業利益（販売価格 − 総原価）</div><div class="profit-value ' + opClass + '">' + app.formatYen(cost.operatingProfit) + ' 円 (' + cost.operatingProfitRate.toFixed(1) + '%)</div></div>';
      html += '<div style="margin-top:6px;font-size:11px;color:#64748b">※ 方式1では直接費・間接費を区別しないため、限界利益・製造利益は算出されません。方式2以上をご利用ください。</div>';

    } else {
      // ── 方式2以上: 直接原価 → 製造原価 → 総原価 ──
      html += '<div class="cost-line cost-subtotal direct"><span>▶ 直接原価</span><span>' + app.formatYen(cost.directCostTotal) + ' 円</span></div>';
      html += '<div class="cost-line cost-indent"><span>＋ 製造間接費</span><span>' + app.formatYen(cost.mfgIndirectProcess) + ' 円</span></div>';
      html += '<div class="cost-line cost-subtotal manufacturing"><span>▶ 製造原価</span><span>' + app.formatYen(cost.manufacturingCost) + ' 円</span></div>';
      html += '<div class="cost-line cost-indent"><span>＋ 販管費</span><span>' + app.formatYen(cost.sgaIndirectProcess) + ' 円</span></div>';
      html += '<div class="cost-line cost-total"><span>▶ 総原価</span><span>' + app.formatYen(cost.totalCost) + ' 円</span></div>';

      // ── 3利益ライン ──
      var mgClass = cost.marginalProfit >= 0 ? "profit-positive" : "profit-negative";
      var mfClass = cost.manufacturingProfit >= 0 ? "profit-positive" : "profit-negative";
      var opClass = cost.operatingProfit >= 0 ? "profit-positive" : "profit-negative";
      html += '<div class="cost-breakdown" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:8px">';
      html += '<div class="profit-box marginal"><div class="profit-label">限界利益（直接原価ベース）</div><div class="profit-value ' + mgClass + '">' + app.formatYen(cost.marginalProfit) + ' 円 (' + cost.marginalProfitRate.toFixed(1) + '%)</div></div>';
      html += '<div class="profit-box manufacturing"><div class="profit-label">製造利益（製造原価ベース）</div><div class="profit-value ' + mfClass + '">' + app.formatYen(cost.manufacturingProfit) + ' 円 (' + cost.manufacturingProfitRate.toFixed(1) + '%)</div></div>';
      html += '<div class="profit-box operating"><div class="profit-label">営業利益（総原価ベース）</div><div class="profit-value ' + opClass + '">' + app.formatYen(cost.operatingProfit) + ' 円 (' + cost.operatingProfitRate.toFixed(1) + '%)</div></div>';
      html += '</div>';
    }

    // ── 原価構成バーチャート ──
    if (cost.totalCost > 0 && cost.sellingPrice > 0) {
      var barTotal = cost.sellingPrice;
      var segments = [];
      if (cost.materialCost > 0) segments.push({ label: '材料費', value: cost.materialCost, color: '#3b82f6' });
      if (level === 1) {
        // 方式1: 加工費は一括
        if (cost.totalProcessCost > 0) segments.push({ label: '加工費', value: cost.totalProcessCost, color: '#2563eb' });
      } else {
        // 方式2以上: 直接加工費 + 間接費を分離
        var directProcess = cost.directCostTotal - cost.materialCost - cost.outsourcingCost - (cost.specialExpense || 0) - (cost.freightCost || 0);
        if (directProcess > 0) segments.push({ label: '加工費', value: directProcess, color: '#2563eb' });
        if (cost.mfgIndirectProcess > 0) segments.push({ label: '製造間接費', value: cost.mfgIndirectProcess, color: '#f59e0b' });
        if (cost.sgaIndirectProcess > 0) segments.push({ label: '販管費', value: cost.sgaIndirectProcess, color: '#f97316' });
      }
      if (cost.outsourcingCost > 0) segments.push({ label: '外注費', value: cost.outsourcingCost, color: '#7c3aed' });
      var profitVal = cost.operatingProfit;
      if (profitVal > 0) segments.push({ label: '利益', value: profitVal, color: '#16a34a' });

      html += '<div class="cost-bar-chart" style="margin-top:12px">';
      html += '<div class="cost-bar-label" style="font-size:12px;color:#64748b;margin-bottom:4px">原価構成（対 販売価格）</div>';
      html += '<div class="cost-bar-track">';
      segments.forEach(function(seg) {
        var pct = Math.max((seg.value / barTotal) * 100, 0);
        html += '<div class="cost-bar-seg" style="width:' + pct.toFixed(1) + '%;background:' + seg.color + '" title="' + seg.label + ': ' + app.formatYen(seg.value) + '円 (' + pct.toFixed(1) + '%)"></div>';
      });
      if (profitVal < 0) {
        html += '<div class="cost-bar-seg cost-bar-over" style="width:' + Math.min(Math.abs(profitVal) / barTotal * 100, 15).toFixed(1) + '%;background:#dc2626" title="赤字: ' + app.formatYen(Math.abs(profitVal)) + '円"></div>';
      }
      html += '</div>';
      html += '<div class="cost-bar-legend">';
      segments.forEach(function(seg) {
        html += '<span class="cost-bar-legend-item"><span class="cost-bar-dot" style="background:' + seg.color + '"></span>' + seg.label + '</span>';
      });
      if (profitVal < 0) {
        html += '<span class="cost-bar-legend-item"><span class="cost-bar-dot" style="background:#dc2626"></span>赤字</span>';
      }
      html += '</div>';
      html += '</div>';
    }

    html += '</div></div>';
    return html;
  }

  function renderRoutingRow(rt, ri, departments, deptRates, lv1Rate, level) {
    var hours = rt.working_hours || 0;
    var dr, rate, cost;

    var directRate = 0, indirectRate = 0;
    if (level <= 2) {
      directRate = lv1Rate ? lv1Rate.directHourlyRate : 0;
      indirectRate = lv1Rate ? lv1Rate.indirectHourlyRate : 0;
      rate = directRate + indirectRate;
      cost = hours * rate;
    } else {
      dr = deptRates.find(function(r) { return r.dept.id === rt.department_id; });
      directRate = dr ? dr.directHourlyRate : 0;
      indirectRate = dr ? dr.indirectHourlyRate : 0;
      rate = dr ? dr.hourlyRate : 0;
      cost = hours * rate;
    }

    var html = '<tr>';
    html += '<td><input type="number" class="rt-order" data-ri="' + ri + '" value="' + (rt.process_order || ri + 1) + '" min="1" style="width:50px;text-align:center"></td>';
    html += '<td><select class="rt-dept" data-ri="' + ri + '">';
    html += '<option value="">-- 選択 --</option>';
    departments.forEach(function(d) {
      html += '<option value="' + d.id + '"' + (d.id === rt.department_id ? ' selected' : '') + '>' + app.escHtml(d.department_name) + '</option>';
    });
    html += '</select></td>';
    html += '<td><input type="number" class="rt-hours" data-ri="' + ri + '" value="' + hours + '" min="0" step="0.001" style="width:90px;text-align:right"></td>';

    if (level === 1) {
      html += '<td class="num">' + app.formatNum(Math.round(rate)) + '</td>';
      html += '<td class="num">' + app.formatYen(cost) + '</td>';
    } else {
      html += '<td class="num">' + app.formatNum(Math.round(directRate)) + '</td>';
      html += '<td class="num">' + app.formatNum(Math.round(indirectRate)) + '</td>';
      html += '<td class="num">' + app.formatYen(cost) + '</td>';
    }
    html += '<td style="text-align:center"><button type="button" class="btn-sm text-danger rt-remove" data-ri="' + ri + '" title="この工程を削除">削除</button></td>';
    html += '</tr>';
    return html;
  }

  function bindProductEvents(card, idx, data) {
    card.querySelector(".prod-save").addEventListener("click", function() {
      saveProduct(idx);
    });
    card.querySelector(".prod-delete").addEventListener("click", function() {
      deleteProduct(idx);
    });
    card.querySelector(".rt-add").addEventListener("click", function() {
      var data = app.loadData();
      var p = data.products[idx];
      if (!p.routings) p.routings = [];
      var nextOrder = p.routings.length + 1;
      p.routings.push({ department_id: 0, process_order: nextOrder, working_hours: 0 });
      app.saveData(data);
      load();
    });
    card.querySelectorAll(".rt-remove").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var ri = parseInt(this.dataset.ri);
        var data = app.loadData();
        data.products[idx].routings.splice(ri, 1);
        app.saveData(data);
        load();
      });
    });
  }

  function collectProductData(card, cs) {
    var result = {
      product_code: card.querySelector(".pf-code").value.trim(),
      product_name: card.querySelector(".pf-name").value.trim(),
      target_sales_price: parseFloat(card.querySelector(".pf-price").value) || 0,
      direct_material_cost: parseFloat(card.querySelector(".pf-material").value) || 0,
      direct_outsourcing_cost: parseFloat(card.querySelector(".pf-outsource").value) || 0,
      special_direct_expense: parseFloat(card.querySelector(".pf-special").value) || 0
    };
    return result;
  }

  function collectRoutings(card) {
    var routings = [];
    card.querySelectorAll(".routing-tbody tr").forEach(function(row) {
      var deptSel = row.querySelector(".rt-dept");
      if (!deptSel) return;
      routings.push({
        department_id: parseInt(deptSel.value) || 0,
        process_order: parseInt(row.querySelector(".rt-order").value) || 1,
        working_hours: parseFloat(row.querySelector(".rt-hours").value) || 0
      });
    });
    return routings;
  }

  function saveProduct(idx) {
    var cards = document.querySelectorAll(".product-card");
    var card = cards[idx];
    if (!card) return;

    var data = app.loadData();
    var pData = collectProductData(card, data.companySettings);
    pData.routings = collectRoutings(card);

    if (!pData.product_name) {
      app.showToast("製品名を入力してください", "error");
      return;
    }

    pData.id = data.products[idx].id;
    data.products[idx] = pData;
    app.saveData(data);
    app.showToast("製品を保存しました", "success");
    load();
  }

  function addProduct() {
    var data = app.loadData();
    data.products.push({
      id: app.nextId(data.products),
      product_code: "", product_name: "新規製品",
      target_sales_price: 0, direct_material_cost: 0,
      direct_outsourcing_cost: 0, freight_weight: 0,
      special_direct_expense: 0, routings: []
    });
    app.saveData(data);
    load();
  }

  function deleteProduct(idx) {
    var data = app.loadData();
    var p = data.products[idx];
    if (!p) return;
    var name = p.product_name || p.product_code || "この製品";
    if (!confirm("「" + name + "」を削除しますか？\nこの操作は元に戻せません。")) return;
    data.products.splice(idx, 1);
    app.saveData(data);
    app.showToast("製品「" + name + "」を削除しました", "success");
    load();
  }

  // ── 比較ダッシュボード ──
  function renderCompareTable(products, departments, deptRates, lv1Rate, cs, level) {
    if (!products.length) {
      document.getElementById("product-compare").style.display = "none";
      return;
    }

    var contentEl = document.getElementById("product-compare-content");
    var html = '<table class="data-table">';

    if (level === 1) {
      // 方式1: 直間分離なし → シンプルな列構成
      html += '<thead><tr><th>製品</th><th>材料費</th><th>加工費</th><th>外注費</th><th>総原価</th><th>販売価格</th><th>営業利益率</th></tr></thead><tbody>';
      products.forEach(function(p) {
        var c = app.calcEngine.calcProductCostLv1(p, lv1Rate, cs, departments, level);
        var opClass = c.operatingProfitRate >= 0 ? "profit-positive" : "profit-negative";
        html += '<tr>' +
          '<td>' + app.escHtml(p.product_code || "") + ' ' + app.escHtml(p.product_name) + '</td>' +
          '<td class="num">' + app.formatYen(c.materialCost) + '</td>' +
          '<td class="num">' + app.formatYen(c.totalProcessCost) + '</td>' +
          '<td class="num">' + app.formatYen(c.outsourcingCost) + '</td>' +
          '<td class="num" style="font-weight:600">' + app.formatYen(c.totalCost) + '</td>' +
          '<td class="num">' + app.formatYen(c.sellingPrice) + '</td>' +
          '<td class="num ' + opClass + '" style="font-weight:600">' + c.operatingProfitRate.toFixed(1) + '%</td>' +
        '</tr>';
      });
    } else {
      // 方式2以上: 直間分離あり → 詳細な列構成
      html += '<thead><tr><th>製品</th><th>直接材料費</th><th>直接加工費</th><th>直接外注費</th><th>直接原価計</th><th>製造間接費</th><th>製造原価</th><th>販管費</th><th>総原価</th><th>販売価格</th><th>限界利益率</th><th>製造利益率</th><th>営業利益率</th></tr></thead><tbody>';
      products.forEach(function(p) {
        var c;
        if (level === 2) {
          c = app.calcEngine.calcProductCostLv1(p, lv1Rate, cs, departments, level);
        } else {
          c = app.calcEngine.calcProductCost(p, deptRates, cs, level);
        }
        enrichCostResult(c, cs);

        var mgClass = c.marginalProfitRate >= 0 ? "profit-positive" : "profit-negative";
        var mfClass = c.manufacturingProfitRate >= 0 ? "profit-positive" : "profit-negative";
        var opClass = c.operatingProfitRate >= 0 ? "profit-positive" : "profit-negative";
        html += '<tr>' +
          '<td>' + app.escHtml(p.product_code || "") + ' ' + app.escHtml(p.product_name) + '</td>' +
          '<td class="num">' + app.formatYen(c.materialCost) + '</td>' +
          '<td class="num">' + app.formatYen(c.totalDirectProcess) + '</td>' +
          '<td class="num">' + app.formatYen(c.outsourcingCost) + '</td>' +
          '<td class="num" style="font-weight:600">' + app.formatYen(c.directCostTotal) + '</td>' +
          '<td class="num">' + app.formatYen(c.mfgIndirectProcess) + '</td>' +
          '<td class="num" style="font-weight:600">' + app.formatYen(c.manufacturingCost) + '</td>' +
          '<td class="num">' + app.formatYen(c.sgaIndirectProcess) + '</td>' +
          '<td class="num" style="font-weight:600">' + app.formatYen(c.totalCost) + '</td>' +
          '<td class="num">' + app.formatYen(c.sellingPrice) + '</td>' +
          '<td class="num ' + mgClass + '" style="font-weight:600">' + c.marginalProfitRate.toFixed(1) + '%</td>' +
          '<td class="num ' + mfClass + '" style="font-weight:600">' + c.manufacturingProfitRate.toFixed(1) + '%</td>' +
          '<td class="num ' + opClass + '" style="font-weight:600">' + c.operatingProfitRate.toFixed(1) + '%</td>' +
        '</tr>';
      });
    }

    html += '</tbody></table>';
    contentEl.innerHTML = html;
    document.getElementById("product-compare").style.display = "block";
  }

  app.productCost = { init: init, load: load };

})(window.CostApp);
