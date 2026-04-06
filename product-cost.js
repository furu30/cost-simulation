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
      cost = app.calcEngine.calcProductCostLv1(p, lv1Rate, cs, departments);
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
    html += '<button class="btn-icon text-danger prod-delete" data-idx="' + idx + '" title="削除">&#10005;</button>';
    html += '</div>';
    html += '</div>';

    // 基本情報
    html += '<div class="form-grid four-col">';
    html += '<label>製品コード</label><input type="text" class="pf-code" value="' + app.escHtml(p.product_code || "") + '">';
    html += '<label>製品名 *</label><input type="text" class="pf-name" value="' + app.escHtml(p.product_name || "") + '">';
    html += '<label>目標販売価格(円)</label><input type="number" class="pf-price input-num" value="' + (p.target_sales_price || 0) + '">';
    html += '<label>直接材料費(円/個) *</label><input type="number" class="pf-material input-num" value="' + (p.direct_material_cost || 0) + '">';
    html += '<label>直接外注費(円/個)</label><input type="number" class="pf-outsource input-num" value="' + (p.direct_outsourcing_cost || 0) + '">';
    html += '<label>特約運送費・直課経費(円)</label><input type="number" class="pf-special input-num" value="' + (p.special_direct_expense || 0) + '">';

    if (cs.enable_freight_cost) {
      html += '<label>製品重量(kg)</label><input type="number" class="pf-weight input-num" step="0.01" value="' + (p.freight_weight || 0) + '">';
      html += '<label></label><span class="text-muted" style="font-size:12px">× ' + app.formatNum(cs.freight_rate_per_unit) + ' 円/kg = ' + app.formatYen((p.freight_weight || 0) * cs.freight_rate_per_unit) + ' 円</span>';
    }
    html += '</div>';

    // ルーティングテーブル
    html += '<h3 style="margin-top:12px">製造ルーティング</h3>';
    html += '<table class="data-table compact">';

    if (level === 1) {
      html += '<thead><tr><th>工順</th><th>工程</th><th>作業時間(h/個)</th><th>レート(円/h)</th><th>加工費</th><th></th></tr></thead>';
    } else {
      html += '<thead><tr><th>工順</th><th>工程</th><th>作業時間(h/個)</th><th>直接レート</th><th>間接レート</th><th>加工費合計</th><th></th></tr></thead>';
    }

    html += '<tbody class="routing-tbody">';
    (p.routings || []).forEach(function(rt, ri) {
      html += renderRoutingRow(rt, ri, departments, deptRates, lv1Rate, level);
    });
    html += '</tbody></table>';
    html += '<button class="btn btn-sm rt-add" data-idx="' + idx + '" style="margin-top:4px">+ 工程追加</button>';

    // ── 原価結果 ──
    html += '<div class="cost-result">';

    // ── 直接原価内訳 ──
    html += '<div class="cost-line"><span>直接材料費</span><span>' + app.formatYen(cost.materialCost) + ' 円</span></div>';

    cost.routingDetails.forEach(function(rd) {
      var detail = rd.dept_name + ' (' + rd.working_hours.toFixed(4) + 'h)';
      if (rd.directCost !== undefined) {
        detail += ' [直接: ' + app.formatYen(rd.directCost) + ' + 間接: ' + app.formatYen(rd.indirectCost) + ']';
      }
      html += '<div class="cost-line"><span>' + app.escHtml(rd.dept_name) + ' (' + rd.working_hours.toFixed(4) + 'h)</span><span>' + app.formatYen(rd.cost) + ' 円</span></div>';
    });

    if (cost.outsourcingCost > 0) {
      html += '<div class="cost-line"><span>直接外注費</span><span>' + app.formatYen(cost.outsourcingCost) + ' 円</span></div>';
    }
    if (cost.specialExpense > 0) {
      html += '<div class="cost-line"><span>特約運送費・直課経費</span><span>' + app.formatYen(cost.specialExpense) + ' 円</span></div>';
    }
    if (cost.freightCost > 0) {
      html += '<div class="cost-line"><span>運送費（配賦）</span><span>' + app.formatYen(cost.freightCost) + ' 円</span></div>';
    }

    // ── 直接原価 ──
    html += '<div class="cost-line cost-subtotal direct"><span>▶ 直接原価</span><span>' + app.formatYen(cost.directCostTotal) + ' 円</span></div>';

    // ── 製造間接費 → 製造原価 ──
    html += '<div class="cost-line cost-indent"><span>＋ 製造間接費</span><span>' + app.formatYen(cost.mfgIndirectProcess) + ' 円</span></div>';
    html += '<div class="cost-line cost-subtotal manufacturing"><span>▶ 製造原価</span><span>' + app.formatYen(cost.manufacturingCost) + ' 円</span></div>';

    // ── 販管費 → 総原価 ──
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
    html += '<td><button type="button" class="btn-icon text-danger rt-remove" data-ri="' + ri + '">&#10005;</button></td>';
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
      special_direct_expense: parseFloat(card.querySelector(".pf-special").value) || 0,
      freight_weight: 0
    };
    var weightEl = card.querySelector(".pf-weight");
    if (weightEl) result.freight_weight = parseFloat(weightEl.value) || 0;
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

    html += '<thead><tr><th>製品</th><th>直接材料費</th><th>直接加工費</th><th>直接外注費</th><th>直接原価計</th><th>製造間接費</th><th>製造原価</th><th>販管費</th><th>総原価</th><th>販売価格</th><th>限界利益率</th><th>製造利益率</th><th>営業利益率</th></tr></thead><tbody>';

    products.forEach(function(p) {
      var c;
      if (level <= 2) {
        c = app.calcEngine.calcProductCostLv1(p, lv1Rate, cs, departments);
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

    html += '</tbody></table>';
    contentEl.innerHTML = html;
    document.getElementById("product-compare").style.display = "block";
  }

  app.productCost = { init: init, load: load };

})(window.CostApp);
