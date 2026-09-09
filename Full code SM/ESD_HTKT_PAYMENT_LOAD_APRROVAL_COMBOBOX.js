/**
 * ScriptLibrary:
 * ESD_HTKT_PAYMENT_LOAD_APPROVAL_COMBOBOX
 *
 * Hàm public:
 * loadPaymentApprovalComboBoxes()
 *
 */
// trưởng thêm
function getPaymentRoleByRights(contactId) {
	var RIGHT_VIEW_INVOICE = "0040040001000001";
	var RIGHT_VIEW_PAYMENT = "0040040003000001";
	var RIGHT_CREATE_PAYMENT = "0040040003000002";
	var RIGHT_ACCOUNTING_INPUT = "0040040003000003";
	var rights = [];

	contactId = String(contactId == null ? "" : contactId).trim();

	if (!contactId) {
		return "";
	}

	try {
		rights = lib.ESD_PERMS_RIGHTS.permsRight(contactId) || [];

		if (rights.toArray) {
			rights = rights.toArray();
		}
	} catch (e) {
		return "";
	}

	if (!rights || typeof rights.length === "undefined") {
		return "";
	}

	var rightMap = {};

	for (var i = 0; i < rights.length; i++) {
		var rightId = String(rights[i] == null ? "" : rights[i]).trim();

		if (rightId) {
			rightMap[rightId] = true;
		}
	}

	var canCreatePayment =
			rightMap[RIGHT_VIEW_INVOICE] &&
			rightMap[RIGHT_VIEW_PAYMENT] &&
			rightMap[RIGHT_CREATE_PAYMENT];

	if (!canCreatePayment) {
		return "";
	}

	return rightMap[RIGHT_ACCOUNTING_INPUT] ? "kttc" : "dmms";
}


function loadPaymentApprovalComboBoxes() {
	var HTKT_SUB_MODULE = "00401";

	/*
	 * Chặn tuyệt đối việc scope toàn hàng mở combobox cho mọi lv1.
	 * Nghiệp vụ hiện tại yêu cầu gói chặt trong lv1:
	 * CN Hà Nội không được xem/chọn người của CN khác, dù có quyền cao nhất.
	 */
	var ALLOW_GLOBAL_SCOPE_IN_COMBO = false;

	/*
	 * ===== Rights constants =====
	 */
	/*
	 * Quyền xem hóa đơn:
	 * - 0040040001000001: quyền khởi tạo
	 * - 0040040001000004: quyền xử lý/phê duyệt
	 */
	var RIGHT_VIEW_INVOICE_CREATE = "0040040001000001";
	var RIGHT_VIEW_INVOICE_APPROVAL = "0040040001000004";

	/*
	 * Quyền xem danh sách đề nghị thanh toán:
	 * - 0040040003000001: quyền khởi tạo
	 * - 0040040003000009: quyền xử lý/phê duyệt
	 */
	var RIGHT_VIEW_PAYMENT_CREATE = "0040040003000001";
	var RIGHT_VIEW_PAYMENT_APPROVAL = "0040040003000009";

	var RIGHT_CREATE_PAYMENT = "0040040003000002";
	var RIGHT_ACCOUNTING_INPUT = "0040040003000003";
	var RIGHT_CHECK_1 = "0040040003000004";
	var RIGHT_APPROVE_1 = "0040040003000005";
	var RIGHT_APPROVE_2 = "0040040003000006";
	var RIGHT_CHECK_2 = "0040040003000007";
	var RIGHT_APPROVE_3 = "0040040003000008";

	/*
	 * Quyền view dùng cho role khởi tạo và KTTC tiếp nhận.
	 */
	var RIGHTS_VIEW_CREATE = [
		RIGHT_VIEW_INVOICE_CREATE,
		RIGHT_VIEW_PAYMENT_CREATE
	];

	/*
	 * Quyền view dùng cho các combobox xử lý/phê duyệt sau KTTC tiếp nhận.
	 *
	 * Không dùng quyền view khởi tạo tại đây:
	 * - RIGHT_VIEW_INVOICE_CREATE
	 * - RIGHT_VIEW_PAYMENT_CREATE
	 *
	 * Các role DMMS RS1, DMMS phê duyệt, KTTC phê duyệt,
	 * KTTC rà soát 2 và cấp có thẩm quyền dùng bộ quyền view phê duyệt.
	 */
	var RIGHTS_VIEW_APPROVAL = [
		RIGHT_VIEW_INVOICE_APPROVAL,
		RIGHT_VIEW_PAYMENT_APPROVAL
	];

	/*
	 * ===== Role configs =====
	 *
	 * includeRights:
	 * - User bắt buộc phải có đủ các quyền này.
	 *
	 * excludeRights:
	 * - Dùng để tránh user cấp cao xuất hiện nhầm ở combobox cấp thấp,
	 *   do bộ quyền đang thiết kế theo hướng lũy tiến.
	 * - Nếu sau này muốn một user cấp cao xuất hiện ở nhiều combobox,
	 *   chỉ cần bỏ excludeRights tương ứng.
	 *
	 * seedRights:
	 * - Dùng để lấy pool ứng viên ban đầu cho nhanh.
	 * - Sau đó vẫn kiểm tra lại includeRights/excludeRights bằng permsRight().
	 */
	var configs = [{
		key: "kttc",
		label: "KTTC tiếp nhận",
		saveField: "user.checker.kttc",

		/*
		 * KTTC tiếp nhận dùng bộ quyền của khởi tạo:
		 * - 0040040001000001: Xem danh sách & chi tiết hóa đơn - Khởi tạo
		 * - 0040040003000001: Xem danh sách đề nghị thanh toán - Khởi tạo
		 * - 0040040003000002: Lập đề nghị thanh toán
		 * - 0040040003000003: Nhập liệu hạch toán
		 */
		includeRights: RIGHTS_VIEW_CREATE.concat([
			RIGHT_CREATE_PAYMENT,
			RIGHT_ACCOUNTING_INPUT
		]),

		excludeRights: [
			RIGHT_CHECK_1,

		],
		seedRights: [
			RIGHT_ACCOUNTING_INPUT
		],
		valueList: "$L.kttc.ids",
		displayList: "$L.kttc.names"
	},

		{
			key: "dmmsRs1",
			label: "DMMS rà soát 1",
			saveField: "user.checker.dmms",
			includeRights: RIGHTS_VIEW_APPROVAL.concat([
				RIGHT_CHECK_1
			]),
			excludeRights: [
				RIGHT_APPROVE_1,
				RIGHT_APPROVE_2,
				RIGHT_CHECK_2,
				RIGHT_APPROVE_3
			],
			seedRights: [
				RIGHT_CHECK_1
			],
			valueList: "$L.dmms.ids",
			displayList: "$L.dmms.rs1"
		},

		{
			key: "dmmsApproval1",
			label: "DMMS phê duyệt cấp 1",
			saveField: "user.approver.dmms",
			includeRights: RIGHTS_VIEW_APPROVAL.concat([
//                RIGHT_CHECK_1,
				RIGHT_APPROVE_1
			]),
			excludeRights: [
				RIGHT_APPROVE_2,
				RIGHT_CHECK_2,
				RIGHT_APPROVE_3
			],
			seedRights: [
				RIGHT_APPROVE_1
			],
			valueList: "$L.dmms.approval1.ids",
			displayList: "$L.dmms.approval1"
		},

		{
			key: "kttcApprove2",
			label: "KTTC phê duyệt cấp 2",
			saveField: "user.approver.kttc",
			includeRights: RIGHTS_VIEW_APPROVAL.concat([
				//                RIGHT_ACCOUNTING_INPUT,
//                RIGHT_CHECK_1,
//                RIGHT_APPROVE_1,
				RIGHT_APPROVE_2
			]),
			excludeRights: [
				RIGHT_CHECK_2,
				RIGHT_APPROVE_3
			],
			seedRights: [
				RIGHT_APPROVE_2
			],
			valueList: "$L.kttc.approve2.ids",
			displayList: "$L.kttc.approve2"
		},

		{
			key: "kttcCheck2",
			label: "KTTC rà soát 2",
			saveField: "user.checker.final",
			includeRights: RIGHTS_VIEW_APPROVAL.concat([
				RIGHT_CHECK_2
			]),
			excludeRights: [
				RIGHT_APPROVE_3
			],
			seedRights: [
				RIGHT_CHECK_2
			],
			valueList: "$L.kttc.check2.ids",
			displayList: "$L.kttc.check2"
		},

		{
			key: "approveAll",
			label: "Phê duyệt cấp có thẩm quyền",
			saveField: "user.approver.final",

			/*
			 * Cấp có thẩm quyền chỉ cần:
			 * - 0040040001000004: Xem danh sách & chi tiết hóa đơn - Phê duyệt
			 * - 0040040003000009: Xem danh sách đề nghị thanh toán - Phê duyệt
			 * - 0040040003000008: Phê duyệt đề nghị thanh toán cấp 3
			 */
			includeRights: RIGHTS_VIEW_APPROVAL.concat([
				RIGHT_APPROVE_3
			]),

			excludeRights: [],
			seedRights: [
				RIGHT_APPROVE_3
			],
			valueList: "$L.approve.all.ids",
			displayList: "$L.approve.all"
		}
	];

	var output = {
		success: true,
		message: "",
		currentUser: "",
		currentUserScope: null,
		targetLv1: "",
		targetLv1Source: "",
		configs: []
	};

	/* Cache trong một lần load form để không truy vấn lặp cùng user/role. */
	var userRightsCache = {};
	var userRightMapCache = {};
	var userScopeCache = {};
	var contactPoolCache = {};
	var contactDataCache = {};
	var orgUnitCache = {};

	var file = vars["$L.file"];

	var targetInfo = getPaymentTargetLv1(file);

	output.targetLv1 = targetInfo.lv1;
	output.targetLv1Source = targetInfo.source;

	if (!output.targetLv1) {
		clearAllComboBoxes(configs);

		output.success = false;
		output.message = "Không xác định được lv1 của hồ sơ thanh toán.";

		return output;
	}

	/*
	 * ===== Guard quan trọng nhất =====
	 * Người đăng nhập phải có data permission 00401 trong đúng lv1 của hồ sơ.
	 * Nếu không có, clear toàn bộ combobox và dừng.
	 */
	var currentUser = normalizeValue(
			safeVarGet("$lo.contact.name", "")
	);

	output.currentUser = currentUser;

	if (!currentUser) {

		clearAllComboBoxes(configs);

		output.success = false;
		output.message = "Không xác định được user đăng nhập.";

		return output;
	}

	var currentUserScope = getUserScopeContext(currentUser, output.targetLv1);

	output.currentUserScope = currentUserScope;

	if (!currentUserScope.canAccessTargetLv1) {
		clearAllComboBoxes(configs);

		output.success = false;
		output.message =
				"User đăng nhập không có phân quyền dữ liệu " +
				HTKT_SUB_MODULE +
				" trong lv1 của hồ sơ: " +
				output.targetLv1;
		return output;
	}


	/*
	 * User đăng nhập hợp lệ thì mới load danh sách combobox.
	 */
	preloadRoleRights();

	for (var i = 0; i < configs.length; i++) {
		var config = configs[i];

		var result = loadOneComboBox(config, output.targetLv1);

		output[config.key] = result;
		output.configs.push({
			key: config.key,
			label: config.label,
			valueList: config.valueList,
			displayList: config.displayList,
			saveField: config.saveField,
			count: result.count
		});

		if (!result.success) {
			output.success = false;
		}
	}

	output.message = output.success ?
			"Load danh sách combobox thành công." :
			"Có combobox load không thành công.";

	return output;

	/* =========================================================
	 * LOAD COMBO
	 * ========================================================= */

	function clearAllComboBoxes(configs) {
		for (var i = 0; i < configs.length; i++) {
			vars[configs[i].valueList] = [];
			vars[configs[i].displayList] = [];
		}
	}

	function loadOneComboBox(config, targetLv1) {
		var result = {
			success: false,
			label: config.label,
			saveField: config.saveField,
			targetLv1: targetLv1,
			count: 0,
			ids: [],
			names: [],
			message: "",
			debug: {
				poolCount: 0,
				passedCount: 0,
				rejectedCount: 0
			}
		};

		vars[config.valueList] = [];
		vars[config.displayList] = [];

		try {

			var contactIds = getContactsForRoleInLv1(config, targetLv1);

			result.debug.poolCount = contactIds.poolCount;
			result.debug.rejectedCount = contactIds.rejectedCount;

			var comboData = readContactData(contactIds.ids);


			if (comboData.ids.length !== comboData.names.length) {
				throw new Error(
						config.valueList +
						" và " +
						config.displayList +
						" không cùng số phần tử."
				);
			}

			vars[config.valueList] = comboData.ids;
			vars[config.displayList] = comboData.names;

			result.success = true;
			result.count = comboData.ids.length;
			result.ids = comboData.ids;
			result.names = comboData.names;
			result.debug.passedCount = comboData.ids.length;

			result.message = result.count > 0 ?
					"Load danh sách thành công." :
					"Không tìm thấy cán bộ phù hợp.";

		} catch (e) {
			vars[config.valueList] = [];
			vars[config.displayList] = [];

			result.success = false;
			result.message = String(e.message || e);
		}

		return result;
	}

	function getContactsForRoleInLv1(config, targetLv1) {
		var output = {
			ids: [],
			poolCount: 0,
			rejectedCount: 0
		};

		var seedRights = normalizeArray(config.seedRights);
		var includeRights = normalizeArray(config.includeRights);
		var excludeRights = normalizeArray(config.excludeRights);

		var pool = getContactPoolByRights(
				seedRights.length > 0 ? seedRights : includeRights
		);

		pool = normalizeArray(pool);

		output.poolCount = pool.length;
		var result = [];

		for (var i = 0; i < pool.length; i++) {
			var contactId = normalizeValue(pool[i]);

			if (!contactId) {
				output.rejectedCount++;
				continue;
			}

			if (!contactHasRightRule(contactId, includeRights, excludeRights)) {
				output.rejectedCount++;
				continue;
			}

			/*
			 * Check user ứng viên cũng phải có data permission 00401 trong lv1 hồ sơ.
			 */
			if (!contactDataPermissionInLv1(contactId, targetLv1)) {
				output.rejectedCount++;
				continue;
			}

			result.push(contactId);
		}

		output.ids = normalizeArray(result);

		return output;
	}


	function getContactPoolByRights(rightIds) {
		rightIds = normalizeArray(rightIds);

		if (rightIds.length === 0) {
			return [];
		}

		var cacheKey = rightIds.slice(0).sort().join("|");
		if (contactPoolCache.hasOwnProperty(cacheKey)) {
			return contactPoolCache[cacheKey].slice(0);
		}

		try {
			if (
					lib.ESD_PERMS_RIGHTS &&
					lib.ESD_PERMS_RIGHTS.listContactsByRights
			) {
				var contactsByRights = normalizeArray(
						lib.ESD_PERMS_RIGHTS.listContactsByRights(rightIds) || []
				);
				contactPoolCache[cacheKey] = contactsByRights;
				return contactsByRights.slice(0);
			}
		} catch (e1) {}

		/*
		 * Fallback nếu môi trường không expose listContactsByRights().
		 * Không truyền filter org ở đây, vì phạm vi dữ liệu sẽ check bằng
		 * getUnitByDataPermissions(contact, "00401") ở bước sau.
		 */
		try {
			if (
					lib.ESD_PERMS_RIGHTS &&
					lib.ESD_PERMS_RIGHTS.listContactsByRightsAndFilter
			) {
				var contactsByFilter = normalizeArray(
						lib.ESD_PERMS_RIGHTS.listContactsByRightsAndFilter(
								rightIds, {}
						) || []
				);
				contactPoolCache[cacheKey] = contactsByFilter;
				return contactsByFilter.slice(0);
			}
		} catch (e2) {}

		contactPoolCache[cacheKey] = [];
		return [];
	}

	/*
	 * Dùng API chung để lấy danh sách user theo từng quyền liên quan.
	 * Đảo danh sách thành quyền theo user, tránh permsRight cho từng ứng viên.
	 * Không dùng query riêng và không cache quyền giữa các lần load form.
	 * Chỉ công bố cache khi mọi lời gọi thành công; lỗi dùng lại đường cũ.
	 */
	function preloadRoleRights() {
		var started = new Date().getTime();
		output.rightsLoad = { mode: "fallback", elapsedMs: 0 };
		try {
			var needed = [];
			for (var i = 0; i < configs.length; i++) {
				needed = needed.concat(configs[i].includeRights,
						configs[i].excludeRights, configs[i].seedRights);
			}
			needed = normalizeArray(needed);
			var rightsByContact = {};
			var contactsByRight = {};
			for (var j = 0; j < needed.length; j++) {
				// Gọi trực tiếp để lỗi không bị chuyển thành danh sách rỗng:
				// thiếu dữ liệu excludeRights có thể cho phép nhầm user.
				var contacts = normalizeArray(
						lib.ESD_PERMS_RIGHTS.listContactsByRights([needed[j]]) || []
				);
				contactsByRight["$" + needed[j]] = contacts;
				for (var k = 0; k < contacts.length; k++) {
					var key = "$" + contacts[k];
					if (!rightsByContact[key]) rightsByContact[key] = [];
					rightsByContact[key].push(needed[j]);
				}
			}
			for (var key in rightsByContact) {
				if (rightsByContact.hasOwnProperty(key)) {
					userRightsCache[key.substring(1)] = rightsByContact[key];
				}
			}
			for (var c = 0; c < configs.length; c++) {
				var seeds = normalizeArray(configs[c].seedRights);
				if (!seeds.length) seeds = normalizeArray(configs[c].includeRights);
				var pool = [];
				for (var n = 0; n < seeds.length; n++) {
					pool = pool.concat(contactsByRight["$" + seeds[n]] || []);
				}
				contactPoolCache[seeds.slice(0).sort().join("|")] = normalizeArray(pool);
			}
			output.rightsLoad.mode = "shared-rights";
			output.rightsLoad.rightCount = needed.length;
		} catch (e) {
			output.rightsLoad.message = String(e.message || e);
		} finally {
			output.rightsLoad.elapsedMs = new Date().getTime() - started;
		}
	}

	function getCachedUserRights(contactId) {
		contactId = normalizeValue(contactId);
		if (!contactId) return [];

		if (!userRightsCache.hasOwnProperty(contactId)) {
			try {
				userRightsCache[contactId] = normalizeArray(
						lib.ESD_PERMS_RIGHTS.permsRight(contactId) || []
				);
			} catch (e) {
				userRightsCache[contactId] = [];
			}
		}

		return userRightsCache[contactId];
	}

	function contactHasRightRule(contactId, includeRights, excludeRights) {
		var cacheKey = "$" + contactId;
		var map = userRightMapCache[cacheKey];
		if (!map) {
			var userRights = getCachedUserRights(contactId);
			map = {};
			for (var i = 0; i < userRights.length; i++) {
				map[userRights[i]] = true;
			}
			userRightMapCache[cacheKey] = map;
		}

		for (var j = 0; j < includeRights.length; j++) {
			if (!map[includeRights[j]]) {
				return false;
			}
		}

		for (var k = 0; k < excludeRights.length; k++) {
			if (map[excludeRights[k]]) {
				return false;
			}
		}

		return true;
	}

	function contactDataPermissionInLv1(contactId, targetLv1) {
		var ctx = getUserScopeContext(contactId, targetLv1);
		return ctx.canAccessTargetLv1 === true;
	}

	/* =========================================================
	 * CURRENT USER / CANDIDATE USER SCOPE
	 * ========================================================= */

	function getUserScopeContext(contactId, targetLv1) {
		var normalizedContactId = normalizeValue(contactId);
		var normalizedTargetLv1 = normalizeUnitCode(targetLv1);
		var cacheKey = normalizedContactId + "|" + normalizedTargetLv1;

		if (!userScopeCache.hasOwnProperty(cacheKey)) {
			userScopeCache[cacheKey] = buildUserScopeContext(
					normalizedContactId,
					normalizedTargetLv1
			);
		}

		return userScopeCache[cacheKey];
	}

	function buildUserScopeContext(contactId, targetLv1) {

		targetLv1 = normalizeUnitCode(targetLv1);

		var result = {
			contactId: contactId,
			targetLv1: targetLv1,
			scope: "",
			rawUnits: [],
			resolvedLv1List: [],
			canAccessTargetLv1: false,
			message: ""
		};

		if (!contactId || !targetLv1) {
			result.message = "Thiếu contactId hoặc targetLv1.";
			print("[ERROR] " + result.message);
			return result;
		}

		var dp = null;

		try {
			dp = lib.ESD_PERMS_RIGHTS.getUnitByDataPermissions(
					contactId,
					HTKT_SUB_MODULE
			) || {};


		} catch (e) {
			result.message = String(e.message || e);

			print("[EXCEPTION] " + result.message);

			return result;
		}

		result.scope = normalizeValue(
				dp.scope ||
				dp.dataScopeList ||
				dp["permission.scope"] ||
				""
		);


		if (!result.scope) {
			result.scope = "QT_PQDL_01";
			print("[SCOPE] Không có scope -> mặc định QT_PQDL_01");
		}

		result.rawUnits = normalizeArray(
				dp.unit ||
				dp.arrUnitRights ||
				dp.units ||
				[]
		);


		/*
		 * Scope toàn hàng
		 */
		if (result.scope === "QT_PQDL_06") {

			result.canAccessTargetLv1 =
					ALLOW_GLOBAL_SCOPE_IN_COMBO === true;

			result.message =
					result.canAccessTargetLv1 ?
							"User có scope toàn hàng và hệ thống cho phép dùng toàn hàng." :
							"User có scope toàn hàng nhưng nghiệp vụ đang chặn mở dữ liệu khác lv1.";

			return result;
		}

		/*
		 * Scope cá nhân
		 */
		if (result.scope === "QT_PQDL_01") {

			result.canAccessTargetLv1 = false;
			result.message =
					"User chỉ có scope cá nhân, không được load combobox theo lv1.";

			return result;
		}

		if (result.rawUnits.length === 0) {

			result.canAccessTargetLv1 = false;
			result.message =
					"User có scope đơn vị nhưng không có unit phân quyền dữ liệu.";

			return result;
		}


		result.resolvedLv1List =
				resolveLv1ListFromUnits(result.rawUnits);


		for (var i = 0; i < result.resolvedLv1List.length; i++) {

			var currentLv1 =
					normalizeUnitCode(result.resolvedLv1List[i]);

			if (currentLv1 === targetLv1) {

				result.canAccessTargetLv1 = true;
				result.message =
						"User có data permission 00401 trong lv1 của hồ sơ.";

				return result;
			}
		}

		result.canAccessTargetLv1 = false;
		result.message =
				"User không có data permission 00401 trùng lv1 của hồ sơ.";

		return result;
	}

	/* =========================================================
	 * TARGET LV1
	 * ========================================================= */

	function getPaymentTargetLv1(file) {
		var result = {
			lv1: "",
			source: ""
		};

		/*
		 * Ưu tiên lv1 của hồ sơ.
		 */
		var lv1 = normalizeUnitCode(
				safeFileGet(file, [
					"unit.lv1",
					"unit_lv1",
					"lv1.id",
					"lv1_id"
				])
		);

		if (lv1) {
			result.lv1 = lv1;
			result.source = "$L.file.unit.lv1";
			return result;
		}

		/*
		 * Nếu hồ sơ chỉ có unit.id thì resolve ngược lên lv1.
		 */
		var unitId = normalizeUnitCode(
				safeFileGet(file, [
					"unit.id",
					"unit_id",
					"unit"
				])
		);

		if (unitId) {
			result.lv1 = resolveLv1FromUnit(unitId);
			result.source = "$L.file.unit.id";
			return result;
		}

		/*
		 * Fallback cho màn add/new nếu hồ sơ chưa có unit.lv1.
		 * Dùng lv1 của user đăng nhập.
		 * Sau đó vẫn có guard currentUserScope để đảm bảo hợp lệ.
		 */
		var currentContactLv1 = normalizeUnitCode(
				safeVarGet("$G.contacts.lv1", "")
		);

		if (currentContactLv1) {
			result.lv1 = currentContactLv1;
			result.source = "$G.contacts.lv1";
			return result;
		}

		var currentUnit = normalizeUnitCode(
				safeVarGet("$unit", "")
		);

		if (currentUnit) {
			result.lv1 = resolveLv1FromUnit(currentUnit);
			result.source = "$unit";
			return result;
		}

		return result;
	}

	/* =========================================================
	 * ORG UNIT RESOLVE
	 * ========================================================= */

	function resolveLv1ListFromUnits(unitArr) {
		var result = [];
		var units = normalizeArray(unitArr);

		for (var i = 0; i < units.length; i++) {
			var lv1 = resolveLv1FromUnit(units[i]);

			if (lv1) {
				result.push(lv1);
			}
		}

		return normalizeArray(result);
	}

	function resolveLv1FromUnit(unitCode) {
		unitCode = normalizeUnitCode(unitCode);

		if (!unitCode) {
			return "";
		}

		var currentUnit = unitCode;
		var seen = {};
		var maxLoop = 10;

		for (var i = 0; i < maxLoop; i++) {
			if (!currentUnit) {
				return "";
			}

			if (seen[currentUnit]) {
				return "";
			}

			seen[currentUnit] = true;

			var detail = lookupOrgUnit(currentUnit);

			if (!detail.found) {
				/*
				 * Fallback: giữ lại unit hiện tại để không làm rỗng dữ liệu.
				 * Nếu gặp case này trong test thì cần kiểm tra lại esdQTorgUnit.
				 */
				return currentUnit;
			}

			if (isLevel1(detail.level)) {
				return detail.unitId;
			}

			if (detail.lv1Id) {
				return detail.lv1Id;
			}

			if (!detail.parentId || detail.parentId === currentUnit) {
				return currentUnit;
			}

			currentUnit = detail.parentId;
		}

		return currentUnit;
	}

	function lookupOrgUnit(unitCode) {
		unitCode = normalizeUnitCode(unitCode);

		var result = {
			found: false,
			recordId: "",
			unitId: unitCode,
			unitName: "",
			level: "",
			status: "",
			parentId: "",
			orgUnit: "",
			lv1Id: ""
		};

		if (!unitCode) {
			return result;
		}

		if (orgUnitCache.hasOwnProperty(unitCode)) {
			return orgUnitCache[unitCode];
		}

		var f = null;

		try {
			f = new SCFile("esdQTorgUnit", SCFILE_READONLY);

			/*
			 * Quan trọng:
			 * esdQTorgUnit.id là mã record nội bộ.
			 * esdQTorgUnit.unit.id mới là mã đơn vị nghiệp vụ.
			 */
			var rc = f.doSelect(
					'unit.id="' + escapeQueryValue(unitCode) + '"'
			);

			if (rc === RC_SUCCESS) {
				result.found = true;
				result.recordId = normalizeValue(f["id"]);
				result.unitId = normalizeUnitCode(f["unit.id"]);
				result.unitName = normalizeValue(f["unit.name"]);
				result.level = normalizeValue(f["level"]);
				result.status = normalizeValue(f["status"]);
				result.parentId = normalizeUnitCode(f["parent.id"]);
				result.orgUnit = normalizeValue(f["org.unit"]);
				result.lv1Id = normalizeUnitCode(f["lv1.id"]);

				if (!result.lv1Id && isLevel1(result.level)) {
					result.lv1Id = result.unitId;
				}
			}
		} finally {
			try {
				if (f) {
					f.doClose();
				}
			} catch (eClose) {}
		}

		orgUnitCache[unitCode] = result;
		return result;
	}

	function isLevel1(level) {
		level = normalizeValue(level);

		/*
		 * Hệ thống có các dạng lv1c/lv1d nên không so sánh cứng bằng "lv1".
		 */
		return level.indexOf("lv1") === 0;
	}

	/* =========================================================
	 * CONTACT DISPLAY
	 * ========================================================= */

	function readContactData(contactIds) {
		var ids = normalizeArray(contactIds);
		var cacheKey = ids.slice(0).sort().join("|");

		var data = {
			ids: [],
			names: []
		};
		if (ids.length === 0) {
			return data;
		}

		if (contactDataCache.hasOwnProperty(cacheKey)) {
			return {
				ids: contactDataCache[cacheKey].ids.slice(0),
				names: contactDataCache[cacheKey].names.slice(0)
			};
		}

		var conditions = [];

		for (var i = 0; i < ids.length; i++) {
			conditions.push(
					'contact.name="' +
					escapeQueryValue(ids[i]) +
					'"'
			);
		}

		var rows = [];
		var seen = {};
		var contactFile = null;

		try {
			contactFile = new SCFile("contacts", SCFILE_READONLY);

			contactFile.setFields([
				"contact.name",
				"full.name",
				"position",
				"status"
			]);

			var rc = contactFile.doSelect(
					"(" + conditions.join(" or ") + ")"
			);

			while (rc === RC_SUCCESS) {
				var contactId = normalizeValue(
						contactFile["contact.name"]
				);

				var status = normalizeValue(
						contactFile["status"]
				);

				/*
				 * Chỉ lấy user đang hoạt động.
				 */
				if (
						contactId &&
						!seen[contactId] &&
						(!status || status === "Dang hoat dong")
				) {
					seen[contactId] = true;

					var fullName = normalizeValue(
							contactFile["full.name"]
					);

					var position = normalizeValue(
							contactFile["position"]
					);

					var display = "";

					if (fullName && position) {
						display = fullName + " - " + position;
					} else if (fullName) {
						display = fullName;
					} else {
						display = contactId;
					}

					rows.push({
						id: contactId,
						display: display
					});
				}

				rc = contactFile.getNext();
			}
		} finally {
			try {
				if (contactFile) {
					contactFile.doClose();
				}
			} catch (eClose) {}
		}

		rows.sort(function(a, b) {
			var da = normalizeValue(a.display).toLowerCase();
			var db = normalizeValue(b.display).toLowerCase();

			if (da < db) return -1;
			if (da > db) return 1;
			return 0;
		});


		for (var j = 0; j < rows.length; j++) {
			data.ids.push(rows[j].id);
			data.names.push(rows[j].display);
		}

		contactDataCache[cacheKey] = {
			ids: data.ids.slice(0),
			names: data.names.slice(0)
		};

		return data;
	}

	/* =========================================================
	 * BASIC UTILS
	 * ========================================================= */

	function normalizeValue(value) {
		return String(value == null ? "" : value).trim();
	}

	function normalizeArray(source) {
		var array = source || [];
		var result = [];
		var seen = {};

		try {
			if (array.toArray) {
				array = array.toArray();
			}
		} catch (eToArray) {
			array = [];
		}

		if (!array || typeof array.length === "undefined") {
			return result;
		}

		for (var i = 0; i < array.length; i++) {
			var value = normalizeValue(array[i]);

			if (value && !seen[value]) {
				seen[value] = true;
				result.push(value);
			}
		}

		return result;
	}

	function normalizeUnitCode(code) {
		var s = normalizeValue(code);

		if (!s) {
			return "";
		}

		s = s.replace(/\.0$/, "");

		/*
		 * Excel bỏ số 0 đầu:
		 * 10639000 -> 010639000
		 */
		if (/^[0-9]+$/.test(s) && s.length === 8) {
			s = "0" + s;
		}

		return s;
	}

	function escapeQueryValue(value) {
		return normalizeValue(value)
				.replace(/\\/g, "\\\\")
				.replace(/"/g, '\\"');
	}

	function safeFileGet(file, fields) {
		if (!file || !fields) {
			return "";
		}

		for (var i = 0; i < fields.length; i++) {
			try {
				var value = file[fields[i]];

				if (value != null && value !== "") {
					return String(value).trim();
				}
			} catch (e1) {}

			try {
				var alt = fields[i].replace(/\./g, "_");
				var value2 = file[alt];

				if (value2 != null && value2 !== "") {
					return String(value2).trim();
				}
			} catch (e2) {}
		}

		return "";
	}

	function safeVarGet(name, defaultValue) {
		try {
			return vars[name] == null ? defaultValue : vars[name];
		} catch (e) {
			return defaultValue;
		}
	}

	function safeStringify(obj) {
		try {
			return JSON.stringify(obj);
		} catch (e) {
			return String(obj);
		}
	}
}
