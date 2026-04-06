(function(app) {
  "use strict";

  // ════════════════════════════════════════════════════
  //  方式1: 全社統一計算（直接/間接分離、全工程統一レート）
  // ════════════════════════════════════════════════════
  /**
   * @param {Object} cs - companySettings
   * @param {Array} departments - 部門一覧（直接原価の合算に使用）
   * @returns {Object} 全社統一の直接/間接レート
   */
  function calcLv1Rate(cs, departments) {
    var commonHours = cs.common_working_hours || 0;
    var commonIndirect = cs.common_indirect_expenses || 0;

    // 全部門の直接原価（人件費＋機械装置費用）と稼働時間を合算
    var totalDirectCost = 0;
    var totalOperatingHours = 0;
    (departments || []).forEach(function(d) {
      totalDirectCost += (d.annual_labor_cost || 0) + (d.standard_machine_cost || 0);
      totalOperatingHours += (d.worker_count || 0) * commonHours;
    });

    var directHourlyRate = totalOperatingHours > 0 ? totalDirectCost / totalOperatingHours : 0;
    var indirectHourlyRate = totalOperatingHours > 0 ? commonIndirect / totalOperatingHours : 0;
    var hourlyRate = directHourlyRate + indirectHourlyRate;

    return {
      totalDirectCost: totalDirectCost,
      totalIndirect: commonIndirect,
      totalHours: totalOperatingHours,
      directHourlyRate: directHourlyRate,
      indirectHourlyRate: indirectHourlyRate,
      hourlyRate: hourlyRate,
      minuteRate: hourlyRate / 60
    };
  }

  // ════════════════════════════════════════════════════
  //  (旧方式2互換: 総レート1種 — 現在は方式2/3共通のcalcDeptRatesLv3を使用)
  // ════════════════════════════════════════════════════
  /**
   * @param {Object} cs - companySettings
   * @param {Array} departments
   * @returns {Array} 部門ごとの計算結果
   */
  function calcDeptRatesLv2(cs, departments) {
    if (!departments.length) return [];

    var commonIndirect = cs.common_indirect_expenses || 0;
    var commonHours = cs.common_working_hours || 0;
    var allocType = cs.allocation_base_type || "worker_count";

    // 配賦基準の合計を計算
    var totalAllocBase = 0;
    departments.forEach(function(d) {
      totalAllocBase += getAllocValue(d, allocType);
    });

    return departments.map(function(dept) {
      var allocValue = getAllocValue(dept, allocType);
      var allocRatio = totalAllocBase > 0 ? allocValue / totalAllocBase : 0;

      // 部門に配賦される共通間接費
      var allocatedIndirect = commonIndirect * allocRatio;

      // 部門固有費 = 作業者年間人件費
      var laborCost = dept.annual_labor_cost || 0;

      // 部門総費用
      var totalCost = laborCost + allocatedIndirect;

      // 稼働時間 = 作業者数 × 共通年間労働時間
      var operatingHours = (dept.worker_count || 0) * commonHours;

      var hourlyRate = operatingHours > 0 ? totalCost / operatingHours : 0;

      return {
        dept: dept,
        allocRatio: allocRatio,
        laborCost: laborCost,
        allocatedIndirect: allocatedIndirect,
        totalCost: totalCost,
        operatingHours: operatingHours,
        hourlyRate: hourlyRate,
        minuteRate: hourlyRate / 60
      };
    });
  }

  // ════════════════════════════════════════════════════
  //  方式2/3共通: 部門別アワーレート（直接/間接分離）
  //  方式2 = 人手主体のみ (allowMachine=false)
  //  方式3 = 人手＋機械混在 (allowMachine=true)
  // ════════════════════════════════════════════════════
  /**
   * @param {Object} cs - companySettings
   * @param {Array} departments
   * @param {boolean} [allowMachine=true] - falseなら全部門を人手主体として計算（方式2用）
   * @returns {Array} 部門ごとの計算結果（直接・間接分離）
   */
  function calcDeptRatesLv3(cs, departments, allowMachine) {
    if (allowMachine === undefined) allowMachine = true;
    if (!departments.length) return [];

    var commonIndirect = cs.common_indirect_expenses || 0;
    var commonHours = cs.common_working_hours || 0;
    var allocType = cs.allocation_base_type || "worker_count";

    var totalAllocBase = 0;
    departments.forEach(function(d) {
      totalAllocBase += getAllocValue(d, allocType);
    });

    return departments.map(function(dept) {
      var allocValue = getAllocValue(dept, allocType);
      var allocRatio = totalAllocBase > 0 ? allocValue / totalAllocBase : 0;
      var isMachine = allowMachine ? dept.is_machine_based : false;

      // ── 直接原価 ──
      var directCost;
      var operatingHours;

      if (isMachine) {
        // 機械主体: 直接原価 = 作業者人件費 ＋ 標準機械費用
        directCost = (dept.annual_labor_cost || 0) + (dept.standard_machine_cost || 0);
        // 稼働時間 = 設備台数 × 1台あたり稼働時間
        operatingHours = (dept.machine_count || 0) * (dept.machine_operating_hours || 0);
      } else {
        // 人手主体: 直接原価 = 作業者人件費 ＋ 機械装置費用
        directCost = (dept.annual_labor_cost || 0) + (dept.standard_machine_cost || 0);
        // 稼働時間 = 作業者数 × 共通年間労働時間
        operatingHours = (dept.worker_count || 0) * commonHours;
      }

      // ── 間接費（配賦） ──
      var allocatedIndirect = commonIndirect * allocRatio;

      var totalCost = directCost + allocatedIndirect;

      // レート計算
      var directHourlyRate = operatingHours > 0 ? directCost / operatingHours : 0;
      var indirectHourlyRate = operatingHours > 0 ? allocatedIndirect / operatingHours : 0;
      var hourlyRate = operatingHours > 0 ? totalCost / operatingHours : 0;

      return {
        dept: dept,
        allocRatio: allocRatio,
        directCost: directCost,
        allocatedIndirect: allocatedIndirect,
        totalCost: totalCost,
        operatingHours: operatingHours,
        directHourlyRate: directHourlyRate,
        directMinuteRate: directHourlyRate / 60,
        indirectHourlyRate: indirectHourlyRate,
        indirectMinuteRate: indirectHourlyRate / 60,
        hourlyRate: hourlyRate,
        minuteRate: hourlyRate / 60
      };
    });
  }

  /**
   * 配賦基準値を取得（人数比/面積比/手動）
   * @param {Object} dept - 部門データ
   * @param {string} allocType - 全社設定の配賦基準区分
   */
  function getAllocValue(dept, allocType) {
    var type = allocType || dept.allocation_base_type || "worker_count";
    if (type === "worker_count") return dept.worker_count || 0;
    if (type === "area" || type === "manual") return dept.allocation_base_value || 0;
    return dept.worker_count || 0;
  }

  // ════════════════════════════════════════════════════
  //  製品原価計算（方式共通）
  // ════════════════════════════════════════════════════

  /**
   * 方式1: 全社統一レートで製品原価計算（直接/間接分離）
   */
  function calcProductCostLv1(product, lv1Rate, cs, departments, level) {
    var materialCost = product.direct_material_cost || 0;
    var outsourcingCost = product.direct_outsourcing_cost || 0;
    var specialExpense = product.special_direct_expense || 0;
    var isLv1 = (level || 1) === 1;

    var totalProcessCost = 0;
    var totalDirectProcess = 0;
    var totalIndirectProcess = 0;
    var routingDetails = [];

    (product.routings || []).forEach(function(rt) {
      var hours = rt.working_hours || 0;
      var cost = hours * lv1Rate.hourlyRate;

      // 工程名を実際の部門名から取得（フォールバック: 全社統一）
      var deptName = "全社統一";
      if (departments) {
        for (var i = 0; i < departments.length; i++) {
          if (departments[i].id === rt.department_id) {
            deptName = departments[i].department_name;
            break;
          }
        }
      }

      var rd = {
        department_id: rt.department_id,
        dept_name: deptName,
        process_order: rt.process_order,
        working_hours: hours,
        hourlyRate: lv1Rate.hourlyRate,
        cost: cost
      };

      if (!isLv1) {
        // 方式2: 直間を分離
        rd.directCost = hours * lv1Rate.directHourlyRate;
        rd.indirectCost = hours * lv1Rate.indirectHourlyRate;
        rd.directHourlyRate = lv1Rate.directHourlyRate;
        rd.indirectHourlyRate = lv1Rate.indirectHourlyRate;
        totalDirectProcess += rd.directCost;
        totalIndirectProcess += rd.indirectCost;
      }

      routingDetails.push(rd);
      totalProcessCost += cost;
    });

    var totalCost = materialCost + totalProcessCost + outsourcingCost + specialExpense;
    var sellingPrice = product.target_sales_price || 0;
    var operatingProfit = sellingPrice - totalCost;
    var operatingProfitRate = sellingPrice > 0 ? operatingProfit / sellingPrice * 100 : 0;

    if (isLv1) {
      // 方式1: 直間分離しないため、限界利益・製造利益は算出不可
      return {
        product: product, calcLevel: 1,
        materialCost: materialCost,
        routingDetails: routingDetails,
        totalProcessCost: totalProcessCost,
        totalDirectProcess: 0,
        totalIndirectProcess: 0,
        outsourcingCost: outsourcingCost,
        specialExpense: specialExpense,
        freightCost: 0,
        totalCost: totalCost,
        sellingPrice: sellingPrice,
        operatingProfit: operatingProfit,
        operatingProfitRate: operatingProfitRate,
        directCostTotal: 0,
        marginalProfit: 0,
        marginalProfitRate: 0,
        mfgIndirectProcess: 0,
        sgaIndirectProcess: 0,
        manufacturingCost: 0,
        manufacturingProfit: 0,
        manufacturingProfitRate: 0
      };
    }

    // 方式2: 直間分離あり → 限界利益算出可能
    var directCostTotal = materialCost + totalDirectProcess + outsourcingCost + specialExpense;
    var marginalProfit = sellingPrice - directCostTotal;
    var marginalProfitRate = sellingPrice > 0 ? marginalProfit / sellingPrice * 100 : 0;

    return {
      product: product, calcLevel: 2,
      materialCost: materialCost,
      routingDetails: routingDetails,
      totalProcessCost: totalProcessCost,
      totalDirectProcess: totalDirectProcess,
      totalIndirectProcess: totalIndirectProcess,
      outsourcingCost: outsourcingCost,
      specialExpense: specialExpense,
      freightCost: 0,
      totalCost: totalCost,
      sellingPrice: sellingPrice,
      operatingProfit: operatingProfit,
      operatingProfitRate: operatingProfitRate,
      directCostTotal: directCostTotal,
      marginalProfit: marginalProfit,
      marginalProfitRate: marginalProfitRate
    };
  }

  /**
   * 方式2/3: 部門別レートで製品原価計算
   */
  function calcProductCost(product, deptRates, cs, calcLevel) {
    calcLevel = calcLevel || 2;
    var materialCost = product.direct_material_cost || 0;
    var outsourcingCost = product.direct_outsourcing_cost || 0;
    var specialExpense = product.special_direct_expense || 0;

    var totalProcessCost = 0;
    var totalDirectProcess = 0;
    var totalIndirectProcess = 0;
    var routingDetails = [];

    (product.routings || []).forEach(function(rt) {
      var dr = deptRates.find(function(r) { return r.dept.id === rt.department_id; });
      if (!dr) return;

      var hours = rt.working_hours || 0;
      var cost = hours * dr.hourlyRate;

      var detail = {
        department_id: rt.department_id,
        dept_name: dr.dept.department_name,
        process_order: rt.process_order,
        working_hours: hours,
        hourlyRate: dr.hourlyRate,
        cost: cost
      };

      if (calcLevel >= 3) {
        detail.directCost = hours * dr.directHourlyRate;
        detail.indirectCost = hours * dr.indirectHourlyRate;
        totalDirectProcess += detail.directCost;
        totalIndirectProcess += detail.indirectCost;
      }

      routingDetails.push(detail);
      totalProcessCost += cost;
    });

    // 運送費
    var totalCost = materialCost + totalProcessCost + outsourcingCost + specialExpense;
    var sellingPrice = product.target_sales_price || 0;
    var operatingProfit = sellingPrice - totalCost;
    var operatingProfitRate = sellingPrice > 0 ? operatingProfit / sellingPrice * 100 : 0;

    var result = {
      product: product, calcLevel: calcLevel,
      materialCost: materialCost,
      routingDetails: routingDetails,
      totalProcessCost: totalProcessCost,
      outsourcingCost: outsourcingCost,
      specialExpense: specialExpense,
      freightCost: 0,
      totalCost: totalCost,
      sellingPrice: sellingPrice,
      operatingProfit: operatingProfit,
      operatingProfitRate: operatingProfitRate
    };

    // 方式3/4: 限界利益
    if (calcLevel >= 3) {
      var directCostTotal = materialCost + totalDirectProcess + outsourcingCost + specialExpense;
      var marginalProfit = sellingPrice - directCostTotal;
      var marginalProfitRate = sellingPrice > 0 ? marginalProfit / sellingPrice * 100 : 0;
      result.directCostTotal = directCostTotal;
      result.totalDirectProcess = totalDirectProcess;
      result.totalIndirectProcess = totalIndirectProcess;
      result.marginalProfit = marginalProfit;
      result.marginalProfitRate = marginalProfitRate;
    }

    return result;
  }

  app.calcEngine = {
    calcLv1Rate: calcLv1Rate,
    calcDeptRatesLv2: calcDeptRatesLv2,
    calcDeptRatesLv3: calcDeptRatesLv3,
    calcProductCostLv1: calcProductCostLv1,
    calcProductCost: calcProductCost
  };

})(window.CostApp);
