var createActivity = lib.ESD_Utils.createActivity;

function run() {

	try {
		var input = vars['$L.file'];

		if (!input) { return; }

		var name = input.name;
		if (!name) {
			input.queryReturn = JSON.stringify({ success: false, error: 'Missing action "name"' });
			return;
		}

		var result;
		switch (name) {
			case 'createPaymentRequest':
				result = createPaymentRequest(input);
				break;
			case 'listPurchaseContracts':
				result = listPurchaseContracts(input);
				break;

			default:
				result = { success: false, message: "Hành động (name) không hợp lệ: " + name };
		}

		// Ép kiểu chuỗi JSON 
		input.queryReturn = JSON.stringify(result);

	} catch (e) {
		if (vars['$L.file']) {
			vars['$L.file'].queryReturn = JSON.stringify({ success: false, error: 'Gateway Error: ' + e.toString() });
		}
	}
}

function createPaymentRequest(input) {
	try {
		var rawData = input.queryString;
		if (!rawData) return { success: false, message: "Thiếu dữ liệu." };

		var contractList = JSON.parse(rawData);
		var contractData = contractList[0];

		/*
		 * HTKT PAYMENT CURRENT USER
		 */
		var currentUser = htktCreatePay_resolveCurrentUser(contractData);
		print("Người dùng hiện tại: " + currentUser);
		if (!currentUser) {
			return {
				success: false,
				message: "Không xác định được người tạo phiếu thanh toán."
			};
		}

		contractData["currentUser"] = currentUser;
		contractData["user"] = currentUser;
		contractData["createdBy"] = currentUser;

		var rawDepartment = contractData['unitLv1'] || contractData['unitLv2'] || contractData['unitLv3'];

		var entityInfo = lib.ESD_HTKT_ACCOUNTING_UTILS.mapPsToEntity(rawDepartment);

		// 2. Lấy giá trị oglBranchCode từ Object trả về
		var oglBranchCode = (entityInfo && entityInfo.oglBranchCode) ? String(entityInfo.oglBranchCode).replace(/^0+/, '') : '';

		var branchCode = oglBranchCode || "100";

		var docType = "TT";

		var paymentRec = new SCFile("esdHTKTpayment");

		var newPaymentId = generateDocumentCode(docType, branchCode);

		// Map dữ liệu
		mapPaymentRecord(paymentRec, contractData, newPaymentId);
		print("New Payment", paymentRec);


		var returnCode;
		var previousSkipAutoPaymentActivity = htktCreatePay_normalizeValue(
				vars["$L.skipAutoPaymentActivity"]
		);

		try {
			vars["$L.skipAutoPaymentActivity"] = "true";
			returnCode = paymentRec.doAction("add");
		} finally {
			/*
			 * Khôi phục giá trị cũ để không ảnh hưởng các xử lý tiếp theo
			 */
			vars["$L.skipAutoPaymentActivity"] = previousSkipAutoPaymentActivity;
		}

		if (returnCode == RC_SUCCESS) {
			/*
			 * Lưu lịch sử với operator là user thật.
			 */
			createActivity(
					"activityHTKTpayment",
					'Thêm mới Đề nghị Thanh toán: Mã đề nghị: "' +
					paymentRec["id"] +
					'"',
					paymentRec["id"],
					"Thêm mới",
					currentUser
			);

			//Đồng bộ giá trị Tạm ứng/Thanh toán giữa Squad 6 và Squad 2
			try {
				lib.ESD_HD_Integration.createContractPayment(paymentRec);
			} catch (ex) {
				print("[ERROR] Đồng bộ createContractPayment thất bại cho ID: " + paymentRec["id"] + " | Detail: " + ex);
			}


			return {
				success: true,
				message: "Thêm đề nghị thanh toán thành công.",
				id: paymentRec['id']
			};
		} else {
			return {
				success: false,
				message: "Lỗi ghi nhận vào Database esdHTKTpayment. Code: " + returnCode
			};
		}

	} catch (error) {

		return { success: false, message: "Lỗi thực thi createPaymentRequest: " + error.toString() };
	}
}

function mapPaymentRecord(paymentRec, contractData, paymentId) {
	// Để null để hệ thống tự động tăng ID khi insert
	paymentRec['id'] = paymentId;

	// 4. Map riêng biệt chi tiết từng trường một từ JSON vào Record
	paymentRec['transaction.type'] = "Thanh toán";
	paymentRec['department'] =
			contractData['unitLv3'] ||
			contractData['unitLv2'] ||
			contractData['unitLv1'] ||
			"";

	paymentRec['description'] = "";

	paymentRec['require.check.level1'] = false;
	paymentRec['require.check.level2'] = false;
	paymentRec['user.checker.kttc'] = "";
	paymentRec['user.checker.dmms'] = "";
	paymentRec['user.approver.dmms'] = "";
	paymentRec['user.approver.kttc'] = "";
	paymentRec['user.checker.final'] = "";
	paymentRec['user.approver.final'] = "";
	paymentRec['return.reason'] = "";
	paymentRec['unit.lv1'] = contractData['unitLv1'] || "";
	paymentRec['unit.lv2'] = contractData['unitLv2'] || "";

	paymentRec['created.at'] = new Date();
	paymentRec['created.by'] = contractData['createdBy'];
	paymentRec['currency'] = "VND";
	paymentRec['total.contract.amount'] = contractData['totalValue'] || 0;
	paymentRec['contract.id'] = contractData['id'];
	paymentRec['contract.name'] = contractData['name'];
	paymentRec['current.phase'] = "start";


	var creatorUser = htktCreatePay_resolveCurrentUser(
			contractData
	);

	if (!creatorUser) {
		throw new Error("Không xác định được người tạo phiếu thanh toán.");
	}

	var initialRole = htktCreatePay_detectInitialRoleByRights(creatorUser);

	if (initialRole === "kttc") {
		paymentRec['status'] = "kttc_created";
		paymentRec['initial.role'] = "kttc";
	} else if (initialRole === "dmms") {
		paymentRec['status'] = "dmms_created";
		paymentRec['initial.role'] = "dmms";
	} else {
		throw new Error(
				"Người tạo " +
				creatorUser +
				" chưa có quyền phù hợp để lập phiếu thanh toán. Cần quyền lập đề nghị thanh toán; nếu là KTTC cần thêm quyền nhập liệu hạch toán."
		);
	}

}


function generateDocumentCode(docType, branchCode) {
	var now = new Date();
	var year = (now.getFullYear() % 100).toString(); // "26"

	var queryPattern = docType + ".*." + year + ".*";
	var query = 'id like "' + queryPattern + '"';

	var file = new SCFile("esdHTKTpayment");
	var rc = file.doSelect(query);

	var maxSeq = 0;

	while (rc == RC_SUCCESS) {
		var currentId = file.id;
		if (currentId) {
			var parts = currentId.split(".");
			var seq = parseInt(parts[parts.length - 1], 10);
			if (!isNaN(seq) && seq > maxSeq) {
				maxSeq = seq;
			}
		}
		rc = file.getNext();
	}

	var newSeq = maxSeq + 1;
	var seqStr = ("0000000" + newSeq).slice(-7);

	return docType + "." + branchCode + "." + year + "." + seqStr;
}

function listPurchaseContracts() {
	var result = {
		total_count: 0,
		data: []
	};

	var countFile = new SCFile('esdHDcontract', SCFILE_READONLY);
	result.total_count = countFile.doCount("true");

	if (result.total_count === 0) {
		return result;
	}

	// 2. Khai báo các trường để lấy dữ liệu
	var fieldMappings = [
		['name', 'name', 'S'],
		['status', 'status', 'S'],
		['current.phase', 'current_phase', 'S'],
		['created.by', 'created_by', 'S'],
		['created.at', 'created_at', 'D'],
		['sysmodtime', 'sysmodtime', 'D'],
		['sysmoduser', 'sysmoduser', 'S'],
		['total.budget', 'total_budget', 'S'],
		['is.budgeted', 'is_budgeted', 'S'],
		['execution.dependency', 'execution_dependency', 'S'],
		['start.date', 'start_date', 'D'],
		['execution.duration', 'execution_duration', 'N'],
		['expected.end.date', 'expected_end_date', 'D'],
		['actual.end.date', 'actual_end_date', 'D'],
		['executor.id', 'executor_id', 'S'],
		['total.executed.value', 'total_executed_value', 'S'],
		['total.unexecuted.value', 'total_unexecuted_value', 'S'],
		['total.paid.amount', 'total_paid_amount', 'S'],
		['remaining.amount', 'remaining_amount', 'S'],
		['category', 'category', 'S'],
		['item.id', 'item_id', 'S'],
		['item.name', 'item_name', 'S'],
		['signed.date', 'signed_date', 'D'],
		['total.contract.value', 'total_contract_value', 'S'],
		['contract.group', 'contract_group', 'S'],
		['contract.value.before.tax', 'contract_value_before_tax', 'S'],
		['contract.value.after.tax', 'contract_value_after_tax', 'S'],
		['tax.amount', 'tax_amount', 'S'],
		['unit.lv1', 'unit_lv1', 'S'],
		['unit.lv2', 'unit_lv2', 'S'],
		['unit.lv3', 'unit_lv3', 'S'],
		['contract.type', 'contract_type', 'S'],
		['contract.no', 'contract_no', 'S'],
		['signer', 'signer', 'S'],
		['note', 'note', 'S'],
		['contract.end.date', 'contract_end_date', 'S'],
		['duration.unit', 'duration_unit', 'S'],
		['contact.list', 'contact_list', 'S']
	];

	var sqlFields = [];
	for (var i = 0; i < fieldMappings.length; i++) {
		sqlFields.push(fieldMappings[i][0]);
	}

	var statusParam = "Dang thuc hien"; // Biến động truyền từ ngoài vào

	var select = " SELECT " + sqlFields.join(", ");
	var mapping = ' FROM esdHDcontract c ';
	//    var control = " WHERE 1=1 AND c.current.phase = '" + statusParam + "'";
	var control = " WHERE 1=1 ";

	var querySQL = select + mapping + control;

	var f = new SCFile('esdHDcontract', SCFILE_READONLY);

	var rc = f.doSelect(querySQL);
	while (rc == RC_SUCCESS) {

		var item = mapRowToObject(f, fieldMappings);
		result.data.push(item);

		rc = f.getNext();
	}

	try { if (f) f.doClose(); } catch (e) {}

	return result;
}

function mapRowToObject(scFileRecord, fieldMappings) {
	var item = {};
	for (var j = 0; j < fieldMappings.length; j++) {
		var jsonKey = fieldMappings[j][1];
		var dataType = fieldMappings[j][2];
		var dbValue = scFileRecord[j];

		if (dataType === "N") {
			item[jsonKey] = dbValue ? Number(dbValue) : 0;
		} else if (dataType === "D") {
			item[jsonKey] = dbValue ? (dbValue.toISOString ? dbValue.toISOString() : String(dbValue)) : "";
		} else {
			item[jsonKey] = dbValue ? String(dbValue) : "";
		}
	}
	return item;
}



function listPurchaseContracts(input) {

	// 1. Lấy dữ liệu linh hoạt từ details hoặc queryString
	var rawData = input ? (input.details || input.queryString) : null;
	if (!rawData) return { success: false, message: "Thiếu dữ liệu đầu vào." };

	var params = {};
	try {
		params = JSON.parse(rawData);
		if (Array.isArray(params)) {
			params = params[0] || {};
		}
	} catch (e) {
		return { success: false, message: "Dữ liệu JSON đầu vào không hợp lệ." };
	}

	/*
	 * HTKT PAYMENT CURRENT USER
	 */
	var currentUser = htktCreatePay_resolveCurrentUser(params);

	if (!currentUser) {
		return {
			success: false,
			message: "Không xác định được người tạo phiếu thanh toán."
		};
	}

	var fieldMappings = [
		['id', 'id', 'S'],
		['name', 'name', 'S'],
		['status', 'status', 'S'],
		['current.phase', 'current.phase', 'S'],
		['created.by', 'created.by', 'S'],
		['created.at', 'created.at', 'D'],
		['sysmodtime', 'sysmodtime', 'D'],
		['sysmoduser', 'sysmoduser', 'S'],
		['total.budget', 'total.budget', 'S'],
		['is.budgeted', 'is.budgeted', 'B'],
		['execution.dependency', 'execution.dependency', 'S'],
		['start.date', 'start.date', 'D'],
		['execution.duration', 'execution.duration', 'N'],
		['expected.end.date', 'expected.end.date', 'D'],
		['actual.end.date', 'actual.end.date', 'D'],
		['executor.id', 'executor.id', 'S'],
		['total.executed.value', 'total.executed.value', 'S'],
		['total.unexecuted.value', 'total.unexecuted.value', 'S'],
		['total.paid.amount', 'total.paid.amount', 'S'],
		['remaining.amount', 'remaining.amount', 'S'],
		['category', 'category', 'S'],
		['item.id', 'item.id', 'S'],
		['item.name', 'item.name', 'S'],
		['signed.date', 'signed.date', 'D'],
		['total.contract.value', 'total.contract.value', 'S'],
		['contract.group', 'contract.group', 'S'],
		['contract.value.before.tax', 'contract.value.before.tax', 'S'],
		['contract.value.after.tax', 'totalValue', 'S'],
		['tax.amount', 'tax.amount', 'S'],
		['unit.lv1', 'unit.lv1', 'S'],
		['unit.lv2', 'unit.lv2', 'S'],
		['unit.lv3', 'unit.lv3', 'S'],
		['contract.type', 'contract.type', 'S'],
		['contract.no', 'contract.no', 'S'],
		['signer', 'signer', 'S'],
		['note', 'note', 'S'],
		['contract.end.date', 'contract.end.date', 'S'],
		['duration.unit', 'duration.unit', 'S'],
		['contact.list', 'contact.list', 'S']

	];

	// 2. Xây dựng điều kiện lọc WHERE
	var conditions = [];

	conditions.push("contract.value.after.tax > 0");
	if (params.status) {
		conditions.push("status=\"" + params.status + "\"");
	}

	var unitLv1Param = params.unitLv1 || params["unit.lv1"];
	if (unitLv1Param) {
		conditions.push("unit.lv1=\"" + unitLv1Param + "\"");
	}

	var whereClause = conditions.length > 0 ? conditions.join(" and ") : "true";



	var sqlFields = fieldMappings.map(function(item) {
		return item[0];
	}).join(", ");

	// Câu SQL Query
	var querySQL = " SELECT " + sqlFields + " FROM esdHDcontract WHERE " + whereClause;

	var dataArray = [];
	var f = new SCFile('esdHDcontract', SCFILE_READONLY);

	try {
		var rc = f.doSelect(querySQL);

		while (rc == RC_SUCCESS) {
			var itemData = mapRowToObject(f, fieldMappings);

			// --- XỬ LÝ ĐỔI GIÁ TRỊ CỦA NAME THEO CATEGORY ---
			if (itemData.category === "HD_KMS") {
				itemData.name = itemData["item.name"] || itemData.name;
			} else if (itemData.category === "HD_GT") {
				itemData.name = itemData.name;
			}

			dataArray.push(itemData);

			rc = f.getNext();
		}
	} catch (e) {
		print("[ERROR listPurchaseContracts] Lỗi doSelect: " + e);
		return {
			success: false,
			message: "Lỗi lấy danh sách hợp đồng mua sắm: " + e.toString()
		};
	} finally {
		try { if (f) f.doClose(); } catch (e) {}
	}

	return {
		success: true,
		data: dataArray
	};
}

function mapRowToObject(scFileRecord, fieldMappings) {
	var item = {};
	for (var j = 0; j < fieldMappings.length; j++) {
		var fieldName = fieldMappings[j][0];
		var jsonKey = fieldMappings[j][1];
		var dataType = fieldMappings[j][2];

		var dbValue = scFileRecord[fieldName];

		if (dataType === "N") {
			item[jsonKey] = dbValue ? Number(dbValue) : 0;
		} else if (dataType === "B") {
			item[jsonKey] = Boolean(dbValue);
		} else if (dataType === "D") {
			item[jsonKey] = dbValue ? (dbValue.toISOString ? dbValue.toISOString() : String(dbValue)) : "";
		} else {
			item[jsonKey] = dbValue ? String(dbValue) : "";
		}
	}
	return item;
}

/* =========================================================
 * HTKT PAYMENT CREATE
 * ========================================================= */

function htktCreatePay_detectInitialRoleByRights(contactId) {
	var RIGHT_VIEW_INVOICE = "0040040003000001";
	var RIGHT_VIEW_PAYMENT = "0040040003000001";
	var RIGHT_CREATE_PAYMENT = "0040040003000002";
	var RIGHT_ACCOUNTING_INPUT = "0040040003000003";

	var rights = htktCreatePay_getRights(contactId);
	print("=== [DEBUG] Kiểm tra quyền của User: " + contactId + " ===");
	print("Danh sách quyền thực tế: " + JSON.stringify(rights));
	/*
	 * Quy tắc nhận diện role khi khởi tạo phiếu:
	 *
	 * 1. KTTC khởi tạo:
	 *    - Có quyền xem hóa đơn
	 *    - Có quyền xem danh sách đề nghị thanh toán
	 *    - Có quyền lập đề nghị thanh toán
	 *    - Có quyền nhập liệu hạch toán
	 *
	 * 2. DMMS khởi tạo:
	 *    - Có quyền xem hóa đơn
	 *    - Có quyền xem danh sách đề nghị thanh toán
	 *    - Có quyền lập đề nghị thanh toán
	 *    - Không bắt buộc quyền rà soát DMMS 1
	 *
	 * Lưu ý:
	 * - 0040040003000004 là quyền Rà soát đề nghị thanh toán 1,
	 *   không phải quyền khởi tạo DMMS.
	 * - Ưu tiên KTTC trước vì KTTC có thêm quyền đặc thù 0003.
	 */

	if (
			htktCreatePay_hasAllRights(rights, [
				RIGHT_VIEW_INVOICE,
				RIGHT_VIEW_PAYMENT,
				RIGHT_CREATE_PAYMENT,
				RIGHT_ACCOUNTING_INPUT
			])
	) {
		return "kttc";
	}

	if (
			htktCreatePay_hasAllRights(rights, [
				RIGHT_VIEW_INVOICE,
				RIGHT_VIEW_PAYMENT,
				RIGHT_CREATE_PAYMENT
			])
	) {
		return "dmms";
	}

	return "";
}

function htktCreatePay_getRights(contactId) {
	try {
		return htktCreatePay_normalizeArray(
				lib.ESD_PERMS_RIGHTS.permsRight(contactId) || []
		);
	} catch (e) {
		return [];
	}
}

function htktCreatePay_hasAllRights(userRights, requiredRights) {
	userRights = htktCreatePay_normalizeArray(userRights);
	requiredRights = htktCreatePay_normalizeArray(requiredRights);

	var map = {};

	for (var i = 0; i < userRights.length; i++) {
		map[userRights[i]] = true;
	}

	for (var j = 0; j < requiredRights.length; j++) {
		if (!map[requiredRights[j]]) {
			return false;
		}
	}

	return true;
}

function htktCreatePay_resolveCurrentUser(source) {
	source = source || {};

	return htktCreatePay_normalizeValue(
			source["currentUser"] ||
			source["current_user"] ||
			source["user"] ||
			source["contactId"] ||
			source["contact_id"] ||
			source["contact.id"] ||
			source["contact.name"] ||
			source["createdBy"] ||
			source["created.by"] ||
			source["created_by"] ||
			""
	);
}

function htktCreatePay_normalizeValue(value) {
	return String(value == null ? "" : value).trim();
}

function htktCreatePay_normalizeArray(source) {
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
		var value = htktCreatePay_normalizeValue(array[i]);

		if (value && !seen[value]) {
			seen[value] = true;
			result.push(value);
		}
	}

	return result;
}

function htktCreatePay_getVar(name) {
	try {
		return vars[name];
	} catch (e) {
		return "";
	}
}

function getOglBranchCodeByDepartment(departmentCode) {
	if (!departmentCode) return "";

	try {
		var entityFile = new SCFile("esdDMentity", SCFILE_READONLY);

		var safeDeptCode = String(departmentCode).trim().replace(/^0+/, "");
		var query = 'ps.code="' + safeDeptCode + '"';

		if (entityFile.doSelect(query) === RC_SUCCESS) {
			var rawOglCode = entityFile["ogl.branch.code"] || "";
			return String(rawOglCode).trim().replace(/^0+/, "");
		}
	} catch (e) {
		print("Lỗi truy vấn esdDMentity: " + e.toString());
	}

	return "";
}
