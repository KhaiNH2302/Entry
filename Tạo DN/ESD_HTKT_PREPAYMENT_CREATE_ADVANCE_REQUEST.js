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
			case 'createAdvanceRequest':
				result = createAdvanceRequest(input);
				break;
			case 'listPurchaseContracts':
				listPurchaseContracts(input);
				break;
			case 'listFileAttachment':
				listFileAttachment(input);
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

function createAdvanceRequest(input) {
	try {
		var rawData = input.queryString;
		if (!rawData) return { success: false, message: "Thiếu dữ liệu." };

		var contractList = JSON.parse(rawData);
		var contractData = contractList[0];


// =========================================================================
		// BỔ SUNG: Tính toán động số tiền còn lại của hợp đồng trước khi tạo phiếu
		// =========================================================================
		var contractId = contractData['id'];

		if (contractId) {
			try {
				// 1. TỔNG GIÁ TRỊ ĐÃ TẠM ỨNG
				var totalPrepayment = "0";
				var prepaymentFile = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
				var sqlPrepayment = 'contract.id="' + contractId + '" and (status="approved" or status="accounted")';

				if (prepaymentFile.doSelect(sqlPrepayment) === RC_SUCCESS) {
					do {
						var prepaymentVendorFile = new SCFile("esdHTKTprepaymentVendor", SCFILE_READONLY);
						if (prepaymentVendorFile.doSelect('prepayment.id="' + prepaymentFile.id + '"') === RC_SUCCESS) {
							do {
								// Đảm bảo amount không bị rỗng/null để thư viện cộng chuỗi không báo lỗi
								var vendorAmt = prepaymentVendorFile.amount ? String(prepaymentVendorFile.amount) : "0";
								totalPrepayment = lib.ESD_HTKT_Utils.addStringsManual(totalPrepayment, vendorAmt);

							} while (prepaymentVendorFile.getNext() === RC_SUCCESS);
						}
						prepaymentVendorFile.doClose();

					} while (prepaymentFile.getNext() === RC_SUCCESS);
				}
				prepaymentFile.doClose();

				// 2. TỔNG GIÁ TRỊ ĐÃ THANH TOÁN
				var totalPayment = "0";

				// 3. GIÁ TRỊ HĐ/KMS CÒN LẠI
				var currentContractAmount = String(contractData['totalValue'] || contractData['contract.amount'] || "0");

				var remainingContractValue = lib.ESD_HTKT_Utils.subtractStringsManual(currentContractAmount, totalPrepayment);
				remainingContractValue = lib.ESD_HTKT_Utils.subtractStringsManual(remainingContractValue, totalPayment);

				// 4. KIỂM TRA CHẶN
				// Ép kiểu về số để kiểm tra <= 0
				if (Number(remainingContractValue) <= 0) {
					return {
						success: false,
						message: "Tổng giá trị HĐ/KMS còn lại của hợp đồng đã về 0. Không thể tạo thêm phiếu tạm ứng mới."
					};
				}

			} catch (eCalc) {
				return {
					success: false,
					message: "Lỗi hệ thống khi tính toán số dư hợp đồng: " + eCalc.toString()
				};
			}
		}
		// =========================================================================
		// =========================================================================
		// =========================================================================
		/*
		 * HTKT PREPAYMENT CURRENT USER
		 */
		var currentUser = htktCreatePrepay_resolveCurrentUser(contractData);

		if (!currentUser) {
			return {
				success: false,
				message: "Không xác định được người tạo phiếu tạm ứng."
			};
		}

		contractData["currentUser"] = currentUser;
		contractData["user"] = currentUser;
		contractData["createdBy"] = currentUser;

		var rawDepartment = contractData['unitLv1'] || contractData['unitLv2'] || contractData['unitLv3'];

		var entityInfo = lib.ESD_HTKT_ACCOUNTING_UTILS.mapPsToEntity(rawDepartment);

		// 2. Lấy giá trị oglBranchCode từ Object trả về
		var oglBranchCode = (entityInfo && entityInfo.oglBranchCode) ? String(entityInfo.oglBranchCode).replace(/^0+/, '') : '';

		// 3. Lấy branchCode (nếu oglBranchCode rỗng thì lấy mặc định "100")
		var branchCode = oglBranchCode;

		if (!branchCode) {
			return {
				success: false,
				message: "Yêu cầu cấu hình đơn vị theo user"
			};
		}

		var docType = "TU";


		var prepaymentRec = new SCFile("esdHTKTprepayment");

		var newPrepaymentId = generateDocumentCode(docType, branchCode);

		// Map dữ liệu
		mapPrepaymentRecord(prepaymentRec, contractData, newPrepaymentId);

		/*
		 * HTKT PREPAYMENT AUTO ACTIVITY -Hanh Code 
		 */
		var returnCode;
		var previousSkipAutoPrepaymentActivity = htktCreatePrepay_normalizeValue(
				vars["$L.skipAutoPrepaymentActivity"]
		);

		try {
			vars["$L.skipAutoPrepaymentActivity"] = "true";
			returnCode = prepaymentRec.doAction("add");
		} finally {
			/*
			 * Khôi phục giá trị cũ để không ảnh hưởng các xử lý tiếp theo
			 */
			vars["$L.skipAutoPrepaymentActivity"] = previousSkipAutoPrepaymentActivity;
		}

		if (returnCode == RC_SUCCESS) {
			/*
			 * Lưu lịch sử với operator là user thật.
			 */
			createActivity(
					"activityHTKTprepayment",
					'Thêm mới Đề nghị Tạm ứng: Mã đề nghị: "' +
					prepaymentRec["id"] +
					'"',
					prepaymentRec["id"],
					"Thêm mới",
					currentUser
			);

			//Đồng bộ giá trị Tạm ứng/Thanh toán giữa Squad 6 và Squad 2
			try {
				lib.ESD_HD_Integration.createContractPayment(prepaymentRec);
			} catch (ex) {
				print("[ERROR] Đồng bộ createContractPayment thất bại cho ID: " + prepaymentRec["id"] + " | Detail: " + ex);
			}


			return {
				success: true,
				message: "Thêm đề nghị tạm ứng thành công.",
				id: prepaymentRec['id']
			};
		} else {
			return {
				success: false,
				message: "Lỗi ghi nhận vào Database esdHTKTprepayment. Code: " + returnCode
			};
		}

	} catch (error) {

		return { success: false, message: "Lỗi thực thi createAdvanceRequest: " + error.toString() };
	}
}

function mapPrepaymentRecord(prepaymentRec, contractData, prepaymentId) {

	// Để null để hệ thống tự động tăng ID khi insert
	prepaymentRec['id'] = prepaymentId;

	// 4. Map riêng biệt chi tiết từng trường một từ JSON vào Record
	prepaymentRec['transaction.type'] = "Tạm ứng";
	prepaymentRec['department'] =
			contractData['unitLv3'] ||
			contractData['unitLv2'] ||
			contractData['unitLv1'] ||
			"";

	prepaymentRec['description'] = "";

	prepaymentRec['require.check.level1'] = false;
	prepaymentRec['require.check.level2'] = false;
	prepaymentRec['user.checker.kttc'] = "";
	prepaymentRec['user.checker.dmms'] = "";
	prepaymentRec['user.approver.dmms'] = "";
	prepaymentRec['user.approver.kttc'] = "";
	prepaymentRec['user.checker.final'] = "";
	prepaymentRec['user.approver.final'] = "";
	prepaymentRec['return.reason'] = "";
	prepaymentRec['unit.lv1'] = contractData['unitLv1'] || "";
	prepaymentRec['unit.lv2'] = contractData['unitLv2'] || "";

	prepaymentRec['created.at'] = new Date();
	prepaymentRec['created.by'] = contractData['createdBy'];
	prepaymentRec['currency'] = "VND";
	prepaymentRec['contract.amount'] = contractData['totalValue'] || 0;
	prepaymentRec['contract.id'] = contractData['id'];
	prepaymentRec['contract.name'] = contractData['name'];
	prepaymentRec['current.phase'] = "start";


	/*
	 * HTKT PREPAYMENT - Hoàng Anh sửa đoạn này
	 *
	 * Bỏ hard-code:
	 * - 099922000 => dmms
	 * - 099917000 => kttc
	 *
	 * Quy tắc mới:
	 * - Tạo mới phiếu tạm ứng vẫn được chọn HĐ/KMS của Khối/CN/ĐVSN khác.
	 * - Vì vậy KHÔNG chặn theo unit.lv1 của hợp đồng tại bước tạo mới.
	 * - Chỉ xác định initial.role/status theo quyền của người tạo.
	 * - Phân quyền theo lv1 sẽ kiểm soát ở bước phân giao/phê duyệt combobox.
	 */
	var creatorUser = htktCreatePrepay_resolveCurrentUser(
			contractData
	);

	if (!creatorUser) {
		throw new Error("Không xác định được người tạo phiếu tạm ứng.");
	}

	var initialRole = htktCreatePrepay_detectInitialRoleByRights(creatorUser);

	if (initialRole === "kttc") {
		prepaymentRec['status'] = "kttc_created";
		prepaymentRec['initial.role'] = "kttc";
	} else if (initialRole === "dmms") {
		prepaymentRec['status'] = "dmms_created";
		prepaymentRec['initial.role'] = "dmms";
	} else {
		throw new Error(
				"Người tạo " +
				creatorUser +
				" chưa có quyền phù hợp để lập phiếu tạm ứng. Cần quyền lập đề nghị tạm ứng; nếu là KTTC cần thêm quyền nhập liệu hạch toán."
		);
	}

}

function generateDocumentCode(docType, branchCode) {
	var now = new Date();
	var year = (now.getFullYear() % 100).toString(); // "26"

	var queryPattern = docType + ".*." + year + ".*";
	var query = 'id like "' + queryPattern + '"';

	var file = new SCFile("esdHTKTprepayment");
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

//function generateDocumentCode(docType, branchCode) {
//    var now = new Date();
//    var year = (now.getFullYear() % 100).toString();
//    
//    var rawSeq = nextId1("esdHTKTprepayment");
//    var seqStr = ("0000000" + rawSeq).slice(-7);
//    
//    return docType + "." + branchCode + "." + year + "." + seqStr;
//}


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
	 * HTKT PREPAYMENT CURRENT USER
	 */
	var currentUser = htktCreatePrepay_resolveCurrentUser(params);

	if (!currentUser) {
		return {
			success: false,
			message: "Không xác định được người tạo phiếu tạm ứng."
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
		['contract.value.after.tax', 'contract.value.after.tax', 'S'],
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

	conditions.push("((category=\"HD_GT\" and contract.value.after.tax > 0) or (category=\"HD_KMS\" and total.budget > 0))");

	var role = params.initialRole || (input ? input.initialRole : null);
	if (role) {
		role = String(role).trim().toLowerCase();
		if (role === "dmms") {
			conditions.push("executor.id=\"" + params.currentUser + "\"");
		}
	}

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

			if (itemData.category === "HD_KMS") {
				itemData.totalValue = itemData["total.budget"];
			} else if (itemData.category === "HD_GT") {
				itemData.totalValue = itemData["contract.value.after.tax"];
			}

			var wrappedItem = {
				"esdHTKTprepaymentPurchaseContracts": itemData
			};

			dataArray.push(JSON.stringify(wrappedItem));

			rc = f.getNext();
		}
	} catch (e) {
		print("[ERROR listPurchaseContracts] Lỗi doSelect: " + e);
	} finally {
		try { if (f) f.doClose(); } catch (e) {}
	}

	// Trả mảng kết quả
	input.queryReturnArray = system.functions.denull(dataArray);
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
 * HTKT PREPAYMENT CREATE
 * ========================================================= */

function htktCreatePrepay_detectInitialRoleByRights(contactId) {
	var RIGHT_VIEW_INVOICE = "0040040001000001";
	var RIGHT_VIEW_PREPAYMENT = "0040040002000001";
	var RIGHT_CREATE_PREPAYMENT = "0040040002000002";
	var RIGHT_ACCOUNTING_INPUT = "0040040002000003";

	var rights = htktCreatePrepay_getRights(contactId);

	/*
	 * Quy tắc nhận diện role khi khởi tạo phiếu:
	 *
	 * 1. KTTC khởi tạo:
	 *    - Có quyền xem hóa đơn
	 *    - Có quyền xem danh sách đề nghị tạm ứng
	 *    - Có quyền lập đề nghị tạm ứng
	 *    - Có quyền nhập liệu hạch toán
	 *
	 * 2. DMMS khởi tạo:
	 *    - Có quyền xem hóa đơn
	 *    - Có quyền xem danh sách đề nghị tạm ứng
	 *    - Có quyền lập đề nghị tạm ứng
	 *    - Không bắt buộc quyền rà soát DMMS 1
	 *
	 * Lưu ý:
	 * - 0040040002000004 là quyền Rà soát đề nghị tạm ứng 1,
	 *   không phải quyền khởi tạo DMMS.
	 * - Ưu tiên KTTC trước vì KTTC có thêm quyền đặc thù 0003.
	 */

	if (
			htktCreatePrepay_hasAllRights(rights, [
				RIGHT_VIEW_INVOICE,
				RIGHT_VIEW_PREPAYMENT,
				RIGHT_CREATE_PREPAYMENT,
				RIGHT_ACCOUNTING_INPUT
			])
	) {
		return "kttc";
	}

	if (
			htktCreatePrepay_hasAllRights(rights, [
				RIGHT_VIEW_INVOICE,
				RIGHT_VIEW_PREPAYMENT,
				RIGHT_CREATE_PREPAYMENT
			])
	) {
		return "dmms";
	}

	return "";
}

function htktCreatePrepay_getRights(contactId) {
	try {
		return htktCreatePrepay_normalizeArray(
				lib.ESD_PERMS_RIGHTS.permsRight(contactId) || []
		);
	} catch (e) {
		return [];
	}
}

function htktCreatePrepay_hasAllRights(userRights, requiredRights) {
	userRights = htktCreatePrepay_normalizeArray(userRights);
	requiredRights = htktCreatePrepay_normalizeArray(requiredRights);

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

function htktCreatePrepay_resolveCurrentUser(source) {
	source = source || {};

	return htktCreatePrepay_normalizeValue(
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

function htktCreatePrepay_normalizeValue(value) {
	return String(value == null ? "" : value).trim();
}

function htktCreatePrepay_normalizeArray(source) {
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
		var value = htktCreatePrepay_normalizeValue(array[i]);

		if (value && !seen[value]) {
			seen[value] = true;
			result.push(value);
		}
	}

	return result;
}

function htktCreatePrepay_getVar(name) {
	try {
		return vars[name];
	} catch (e) {
		return "";
	}
}


//
function listFileAttachment(input) {

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

	// 2. Cập nhật fieldMappings bao gồm các trường từ bảng chính và các bảng join
	var fieldMappings = [
		['id', 'id', 'S'],
		['id.activity.vj', 'id.activity.vj', 'S'],
		['name', 'name', 'S'],
		['status', 'status', 'S'],
		['created.by', 'created.by', 'S'],
		['created.at', 'created.at', 'D'],
		['sysmodtime', 'sysmodtime', 'D'],
		['sysmoduser', 'sysmoduser', 'S'],
		['sizeKb', 'sizeKb', 'N'],
		['parent.id', 'parent.id', 'S'],
		['attach.type', 'attach.type', 'S'],
		['note', 'note', 'S'],
		['executor', 'executor', 'S'],
		['document.type', 'document.type', 'S'],
		['attach.id', 'attach.id', 'S'],
		['table', 'table', 'S'],
		['doc.id', 'doc.id', 'S'],
		['document.source', 'document.source', 'S'],
		['document.date', 'document.date', 'D'],
		['category', 'category', 'S'],
		['step.status', 'step.status', 'S'],
		['transaction.id', 'transaction.id', 'S'],
		['function', 'function', 'S'],
		['original.id', 'original.id', 'S'],

		['at.id', 'at_id', 'S'],
		['at.name', 'at_name', 'S'],
		['p.id', 'p_id', 'S'],
		['p.contract.id', 'p_contract_id', 'S'],
		['p.amount', 'p_amount', 'N']
	];

	// 3. Xây dựng điều kiện lọc WHERE
	var conditions = [];

	if (params.status) {
		conditions.push("status=\"" + params.status + "\"");
	}
	if (params.prepaymentId) {
		conditions.push("p.id=\"" + params.prepaymentId + "\"");
	}

	conditions.push("original.id = at.id");
	conditions.push("p.contract.id = at.parent.id");

	var whereClause = conditions.length > 0 ? conditions.join(" and ") : "true";

	var sqlFields = fieldMappings.map(function(item) {
		return item[0];
	}).join(", ");

	// 4. Truy vấn đa bảng trong Service Manager
	var querySQL = " SELECT " + sqlFields + " FROM esdHDtlks, esdHDattachment at, esdHTKTprepayment p WHERE " + whereClause;

	var dataArray = [];
	var f = new SCFile('esdHDtlks', SCFILE_READONLY);

	try {
		var rc = f.doSelect(querySQL);

		while (rc == RC_SUCCESS) {
			var itemData = mapRowToObject(f, fieldMappings);

			var wrappedItem = {
				"esdHDtlks": itemData
			};

			dataArray.push(JSON.stringify(wrappedItem));

			rc = f.getNext();
		}
	} catch (e) {
		print("[ERROR listFileAttachment] Lỗi doSelect: " + e);
	} finally {
		try { if (f) f.doClose(); } catch (e) {}
	}

	// Trả mảng kết quả
	input.queryReturnArray = system.functions.denull(dataArray);
}

function nextId1(name) {
	var nextNumber = new SCDatum();
	funcs.rtecall("getnumber", 1, nextNumber, name);
	return nextNumber;
}