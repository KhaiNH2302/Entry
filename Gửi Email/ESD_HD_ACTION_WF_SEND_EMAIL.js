var getCommonName = lib.ESD_Utils.getCommonName;
var callRuleSet = lib.ESD_Utils.callRuleSet;
var isCountTicket = lib.ESD_Utils.isCountTicket;
var getFieldsContactsByRightsAndFilter = lib.ESD_PERMS_RIGHTS.getFieldsContactsByRightsAndFilter;
// ===== SEND MAIL =====
/**
 * Email đã làm
 * TEMP01: Cảnh báo sắp hết hạn Hợp đồng / Khoản mua sắm trực tiếp (KMSTT)
 * TEMP02: Cảnh báo sắp hết hạn VB Bảo lãnh/Bảo hành/Bảo đảm
 * TEMP03: Cảnh báo THỜI GIAN THỰC HIỆN của Nội dung thực hiện (NDTH)
 * TEMP04: Cảnh báo sắp đến hạn thực hiện nội dung trong Hợp đồng / Khoản mua sắm trực tiếp

 * TEMP05: Yêu cầu nhập kho
 * TEMP06: Yêu cầu nhập tài sản
 * TEMP07: Xác nhận Yêu cầu nhập kho
 * TEMP08: Xác nhận Yêu cầu nhập tài sản
 * TEMP10: Từ chối nhập tài sản
 * TEMP11: Từ chối nhập kho

 * TEMP09: Gửi yêu cầu xác nhận BBNT CLKT
 * TEMP12: Lãnh đạo xác nhận BBNT CLKT
 * TEMP13: Yêu cầu chỉnh sửa BBNT CLKT

 * TEMP14: Gửi yêu cầu xác nhận BBNT bàn giao
 * TEMP15: Lãnh đạo xác nhận BBNT bàn giao
 * TEMP16: Yêu cầu chỉnh sửa BBNT bàn giao

 * TEMP17: Thông báo hoàn thành triển khai
 * TEMP18: Yêu cầu phê duyệt điều chỉnh
 * TEMP19: Yêu cầu chỉnh sửa yêu cầu triển khai
 * TEMP20: Yêu cầu triển khai chi nhánh đơn vị

 * TEMP27: Yêu cầu chỉnh sửa phiếu thực hiện triển khai (TSC trả về Chi nhánh)
 * TEMP28: TSC xác nhận triển khai
 * TEMP29: Cảnh báo THỜI GIAN THỰC HIỆN của THTK

 * Email chưa làm
 * TEMP21: Lãnh đạo từ chối yêu cầu chỉnh sửa HĐ/KMSTT (updating...)
 * TEMP22: Yêu cầu chỉnh sửa phiếu thực hiện triển khai (TSC trả về chi nhánh) (updating...)
 * TEMP23: Lãnh đạo phê duyệt yêu cầu chỉnh sửa HĐ/KMS (updating...)
 * TEMP24: Thông báo hợp đồng đã hoàn thành (updating...)
 */


function cleanGlobalVariable() {
	vars["$G.mail.receiver"] = null;
	vars["$G.mail.receiver.name"] = null;
}

/**
 * Số ngày từ hiện tại đến ngày đích.
 * > 0: còn X ngày
 * = 0: hôm nay
 * < 0: đã quá hạn
 */
function getDaysUntil(targetDate) {
	if (!targetDate) return null;

	var today = new Date();
	var target = new Date(targetDate);

	// bỏ phần giờ phút giây để tránh lệch ngày
	today.setHours(0, 0, 0, 0);
	target.setHours(0, 0, 0, 0);

	return Math.floor(
			(target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
	);
}

function getDaysBetween(from, to) {
	if (!from || !to) return null;

	var fromDate = new Date(from);
	var toDate = new Date(to);

	fromDate.setHours(0, 0, 0, 0);
	toDate.setHours(0, 0, 0, 0);

	return Math.floor(
			(toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)
	);
}
/**
 * Kiểm tra còn trong thời gian nhắc hạn.
 */
function isReminderDue(targetDate, reminderDays) {
	var daysUntil = getDaysUntil(targetDate);
	if (daysUntil === null) {
		return false;
	}
	reminderDays = parseInt(reminderDays, 10) || 0;
	return daysUntil >= 0 && daysUntil <= reminderDays;
}

function escapeEmailHtml(value) {
	if (value == null || value === "") return "";
	return String(value)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");
}

function escapeSMQuery(value) {
	if (value == null) return "";
	return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function formatEmailNumber(value) {
	if (value == null || value === "") return "";
	var num = parseFloat(String(value).replace(/,/g, ""));
	if (isNaN(num)) return escapeEmailHtml(value);
	var parts = String(num).split(".");
	var integer = parts[0];
	var decimal = parts[1];
	integer = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
	return decimal ? integer + "." + decimal : integer;
}
//===============================================SEND MAIL=========================================================

function sendEmailToCreatedBy(record, ruleSetName) {
	var query = `contact.name="${record.created_by}"`;
	var email_receiver = getCommonName("contacts", query, "email");
	let fullname_receiver = getCommonName("contacts", query, "full.name");
	vars["$G.mail.receiver"] = [email_receiver];
	vars["$G.mail.receiver.name"] = fullname_receiver;

	callRuleSet(record, ruleSetName);
	cleanGlobalVariable();
}

function getContactInfo(contactName) {
	if (!contactName) {
		return null;
	}
	var f = new SCFile("contacts", SCFILE_READONLY);
	try {
		var rc = f.doSelect('contact.name="' + contactName + '"');
		if (rc != RC_SUCCESS) {
			return null;
		}
		return {
			contactName: f["contact.name"],
			fullName: f["full.name"],
			email: f["email"]
		};
	} finally {
		if (f) {
			f.doClose();
		}

	}
}

function sendEmailToUsers(record, ruleSetName, contacts) {
	if (!record || !ruleSetName || !contacts) {
		return false;
	}
	if (!Array.isArray(contacts)) {
		contacts = [contacts];
	}
	// remove null + duplicate contact
	contacts = Array.from(
			new Set(contacts.filter(function(contact) { return contact; }))
	);
	if (!contacts.length) {
		return false;
	}
	var sentEmails = {};
	var success = false;
	for (var i = 0; i < contacts.length; i++) {
		var info = getContactInfo(contacts[i]);
		if (!info || !info.email) {
			continue;
		}
		// tránh 2 contact dùng chung email
		if (sentEmails[info.email]) {
			continue;
		}
		sentEmails[info.email] = true;
		try {
			vars["$G.mail.receiver"] = [info.email];
			vars["$G.mail.receiver.name"] = info.fullName || "";
			callRuleSet(record, ruleSetName);
			success = true;
		} finally {
			cleanGlobalVariable();
		}
	}
	return success;
}
//--------------------------
function sendEmailToContact(record, ruleSetName, contactName) {
	contactName = contactName || record.created_by;
	if (!record || !ruleSetName || !contactName) {
		return false;
	}
	var query = 'contact.name="' + contactName + '"';
	var email = getCommonName("contacts", query, "email");
	if (!email) {
		return false;
	}
	try {
		vars["$G.mail.receiver"] = [email];
		vars["$G.mail.receiver.name"] = getCommonName("contacts", query, "full.name");
		callRuleSet(record, ruleSetName);
		return true;
	} finally {
		cleanGlobalVariable();
	}
}

// Gui nhieu mail 1 luc
//function sendEmailToMultipleContacts(record, ruleSetName, userIds) {
//    if (!record || !ruleSetName || !userIds || userIds.length === 0) {
//        return false;
//    }
//
//    var emailList = [];
//    var fullNameList = [];
//    for (var i = 0; i < userIds.length; i++) {
//        var userId = userIds[i];
//        if (!userId) continue;
//
//        var query = 'contact.name="' + userId + '"';
//        var email = getCommonName("contacts", query, "email");
//        if (email) {
//            emailList.push(email);
//
//            var fullName = getCommonName("contacts", query, "full.name");
//            fullNameList.push(fullName ? fullName : "");
//        }
//    }
//
//    if (emailList.length === 0) {
//        return false;
//    }
//
//    try {
//        vars["$G.mail.receiver"] = emailList;
//        vars["$G.mail.receiver.name"] = fullNameList;
//        callRuleSet(record, ruleSetName);
//        return true;
//    } catch (e) {
//        print("LỖI gửi mail danh sách: " + e.message);
//        return false;
//    } finally {
//        cleanGlobalVariable();
//    }
//}

// 1. TEMP1: Cảnh báo sắp hết hạn HĐ/KMSTT
function sendEmailAlertExpireHD(record) {
	var ruleSetName = "ESD_HD_CONTRACT_SENDEMAIL_TEMP01";
	var receivers = getExpiryWarningReceivers(record);
	for (var i = 0; i < receivers.length; i++) {
		vars["$G.mail.receiver"] = receivers[i].email;
		vars["$G.mail.receiver.name"] = receivers[i].name;
		vars["$G.mail.receiver"].replace(/,+/g, ',').replace(/^,+|,+$/g, '').trim();
		callRuleSet(record, ruleSetName);
		cleanGlobalVariable();
	}
}

//2. TEMP2: Cảnh báo sắp hết hạn VB Bảo lãnh/Bảo hành/Bảo Đảm
function sendEmailAlertExpireGuarantee(record) {
	sendEmailToCreatedBy(record, "ESD_HD_CONTRACT_SENDEMAIL_TEMP02");
}

//3. TEMP3:  Cảnh báo THỜI GIAN THỰC HIỆN của Nội dung thực hiện (NDTH)
function sendEmailAlertNDTH(record) {
	var ruleSetName = "ESD_HD_CONTRACT_SENDEMAIL_TEMP03";
	var receivers = [record.executor_id, record['created.by']];
	sendEmailToUsers(record, ruleSetName, receivers);
}

//4. TEMP04: Cảnh báo sắp đến hạn thực hiện nội dung
function sendEmailAlertExpireNHTH(record) {
	var ruleSetName = "ESD_HD_CONTRACT_SENDEMAIL_TEMP04";
	var receivers = [record.executor_id, record['created.by']];
	sendEmailToUsers(record, ruleSetName, receivers);
}

//5. TEMP05 - Yeu cau nhap kho  - BBNTBG / THUC HIEN TRIEN KHAI;
function sendEmailYCNhapKho(record) {
	var ruleSetName = "ESD_HD_CONTRACT_SENDEMAIL_TEMP05";
	var right = "";
	if (record.category == "BGHHDV") {
		right = "0040030002000004";
	} else if (record.category == "THTK") {
		right = "0040030004000003";
	} else {
		return false;
	}

	var receivers = getFieldsContactsByRightsAndFilter([right], {
				"lv1.id": [record.unit_lv1]
			},
			["contact.name", "full.name", "email"]
	);
	if (!receivers || !receivers.length) {
		return false;
	}

	for (var i = 0; i < receivers.length; i++) {
		var receiver = receivers[i];
		if (!receiver.email) {
			continue;
		}
		try {
			vars["$G.mail.receiver"] = [receiver.email];
			vars["$G.mail.receiver.name"] = receiver["full.name"] || "";
			callRuleSet(record, ruleSetName);
		} finally {
			cleanGlobalVariable();
		}
	}
	return true;
}

//6. TEMP06 - Yeu cau nhap TS
function sendEmailYCNhapTS(record) {
	var ruleSetName = "ESD_HD_CONTRACT_SENDEMAIL_TEMP06";
	var right = "";
	if (record.category == "BGHHDV") {
		right = "0040030002000003";
	} else if (record.category == "THTK") {
		right = "0040030004000002";
	} else {
		return false;
	}
	var receivers = getFieldsContactsByRightsAndFilter([right], {
				"lv1.id": [record.unit_lv1]
			},
			["contact.name", "full.name", "email"]
	);

	if (!receivers || !receivers.length) {
		return false;
	}
	for (var i = 0; i < receivers.length; i++) {
		var receiver = receivers[i];
		if (!receiver.email) {
			continue;
		}
		try {
			vars["$G.mail.receiver"] = [receiver.email];
			vars["$G.mail.receiver.name"] = receiver["full.name"] || "";
			callRuleSet(record, ruleSetName);
		} finally {
			cleanGlobalVariable();
		}
	}
	return true;
}

//7. TEMP07 - Xac nhan nhap kho
function sendEmailXNNhapKho(record) {
	var ruleSetName = "ESD_HD_CONTRACT_SENDEMAIL_TEMP07";
	let sendUser1 = record['executor.id'];
	let sendUser2 = getCommonName("esdHDcontract", `id="${record.contract_id}"`, "executor.id");
	sendEmailToUsers(record, ruleSetName, [sendUser1, sendUser2]);
}

//8. TEMP08 - xac nhan nhap TS
function sendEmailXNNhapTS(record) {
	var ruleSetName = "ESD_HD_CONTRACT_SENDEMAIL_TEMP08";
	let sendUser1 = record['executor.id'];
	let sendUser2 = getCommonName("esdHDcontract", `id="${record.contract_id}"`, "executor.id");
	sendEmailToUsers(record, ruleSetName, [sendUser1, sendUser2]);
}

//10. TEMP10: Từ chối nhập tài sản
function sendEmailTuChoiNhapTaiSan(record) {
	var ruleSetName = "ESD_HD_CONTRACT_SENDEMAIL_TEMP10"
	sendEmailToContact(record, ruleSetName, record.executor_id);
}

//11. TEMP11: Từ chối nhập kho
function sendEmailTuChoiNhapKho(record) {
	var ruleSetName = "ESD_HD_CONTRACT_SENDEMAIL_TEMP11"
	sendEmailToContact(record, ruleSetName, record.executor_id);
}

// ======================= BBNT CLKT ===========================
// ======================= BBNT CLKT ===========================
//9. TEMP09 - Gửi yêu cầu xác nhận BBNT CLKT
function sendMailSendRequestBBNTCLKT(record) {

	var ruleSetName = "ESD_HD_CONTRACT_SENDEMAIL_TEMP09";
	var receivers = getFieldsContactsByRightsAndFilter(["0040030001000003"], {
				"lv2.id": [record.unit_lv2]
			},
			["contact.name", "full.name", "email"]
	);

	var uniqueEmails = {};

	for (var i = 0; i < receivers.length; i++) {
		var email = receivers[i].email;
		// Bỏ qua email rỗng hoặc đã xử lý
		if (!email || uniqueEmails[email]) {
			continue;
		}
		uniqueEmails[email] = true;
		vars["$G.mail.receiver"] = [email];
		vars["$G.mail.receiver.name"] = receivers[i]["full.name"];
		callRuleSet(record, ruleSetName);
		cleanGlobalVariable();
	}
}


//12. TEMP12: Lãnh đạo xác nhận BBNT CLKT
function sendEmailBBNTCLKT_XN(record) {

	var ruleSetName = "ESD_HD_CONTRACT_SENDEMAIL_TEMP12";
	sendEmailToContact(record, ruleSetName, record.executor_id)
}


//13. TEMP13: Yêu cầu chỉnh sửa BBNT CLKT
function sendEmailBBNTCLKT_YCCS(record) {
	var ruleSetName = "ESD_HD_CONTRACT_SENDEMAIL_TEMP13";
	sendEmailToContact(record, ruleSetName, record.executor_id)
}

// ======================= BBNT BÀN GIAO ===========================
// ======================= BBNT BÀN GIAO ===========================

//14. TEMP14: Yêu cầu xác nhận BBNT bàn giao
function sendEmailBBNTBanGiao_YCXN(record) {
	var ruleSetName = "ESD_HD_CONTRACT_SENDEMAIL_TEMP14";
	var receivers = getFieldsContactsByRightsAndFilter(["0040030002000002"], {
				"lv2.id": [record.unit_lv2]
			},
			["contact.name", "full.name", "email"]
	);

	var uniqueEmails = {};

	for (var i = 0; i < receivers.length; i++) {
		var email = receivers[i].email;
		// Bỏ qua email rỗng hoặc đã xử lý
		if (!email || uniqueEmails[email]) {
			continue;
		}
		uniqueEmails[email] = true;
		vars["$G.mail.receiver"] = [email];
		vars["$G.mail.receiver.name"] = receivers[i]["full.name"];
		callRuleSet(record, ruleSetName);
		cleanGlobalVariable();
	}
}


//15. TEMP15: Lãnh đạo xác nhận BBNT bàn giao
function sendEmailBBNTBanGiao_XN(record) {
	var ruleSetName = "ESD_HD_CONTRACT_SENDEMAIL_TEMP15";
	sendEmailToContact(record, ruleSetName, record.executor_id)
}

//16. TEMP16: Yêu cầu chỉnh sửa BBNT bàn giao
function sendEmailBBNTBanGiao_YCCS(record) {
	var ruleSetName = "ESD_HD_CONTRACT_SENDEMAIL_TEMP16";
	sendEmailToContact(record, ruleSetName, record.executor_id)
}

//17. TEMP17:  Thông báo hoàn thành triển khai
function sendEmailTrienKhai_HoanThanh(record) {
	var ruleSetName = "ESD_HD_CONTRACT_SENDEMAIL_TEMP17"
	sendEmailToContact(record, ruleSetName, record.created_by)
}

//18. TEMP18: Yêu cầu phê duyệt điều chỉnh
function sendEmailTrienKhai_PheDuyetDieuChinh(record) {
	var ruleSetName = "ESD_HD_CONTRACT_SENDEMAIL_TEMP18"
	sendEmailToContact(record, ruleSetName, record.executor_id)
}

//19. TEMP19: Yêu cầu chỉnh sửa yêu cầu triển khai
function sendEmailTrienKhai_YeuCauChinhSua(record) {
	var ruleSetName = "ESD_HD_CONTRACT_SENDEMAIL_TEMP19"
	var parentId = record['yctk.id'];
	if (parentId) {
		var parentQuery = 'id="' + parentId + '"';
		var parentCreator = getCommonName("esdHDhandover", parentQuery, "created.by");
		if (parentCreator) {
			sendEmailToContact(record, ruleSetName, parentCreator);
		}
	}
}


//20. TEMP20: Yêu cầu triển khai chi nhánh/đơn vị
function sendEmailTrienKhai_YeuCauCNDV(record, userIds) {
	var ruleSetName = "ESD_HD_CONTRACT_SENDEMAIL_TEMP20"
	sendEmailToUsers(record, ruleSetName, userIds)
}

//27. TEMP27: Yêu cầu chỉnh sửa phiếu thực hiện triển khai (TSC trả về Chi nhánh)
function sendEmailChinhSuaTHTK(record) {
	var ruleSetName = "ESD_HD_CONTRACT_SENDEMAIL_TEMP27"
	sendEmailToContact(record, ruleSetName, record.executor_id);
}

//28. TEMP28: TSC xác nhận triển khai
function sendEmailTscXacNhanTrienKhai(record) {
	var ruleSetName = "ESD_HD_CONTRACT_SENDEMAIL_TEMP28"
	sendEmailToContact(record, ruleSetName, record.executor_id);
}

//29. TEMP29: Cảnh báo THỜI GIAN THỰC HIỆN của THTK
function sendEmailAlertTHTK(record, userIds) {
	var ruleSetName = "ESD_HD_CONTRACT_SENDEMAIL_TEMP29";
	sendEmailToUsers(record, ruleSetName, userIds)
	//    sendEmailToContact(record, ruleSetName,record.executor_id )
}

//31. TEMP31
function sendEmailEditTHTKTSC(record) {
	var ruleSetName = "ESD_HD_CONTRACT_SENDEMAIL_TEMP31";
	sendEmailToContact(record, ruleSetName, record.executor_id);
}

// Lấy ra danh sách nhà cung cấp
function getSuppliers(contractId) {
	var suppliers = [];

	var resultObj = {};
	var f = new SCFile("esdHDcontract");
	var query =
			'SELECT d.* ' +
			'FROM esdHDhandoverHHDV d ' +
			'INNER JOIN esdHDcontractSupplier h ' +
			'ON (d.id = h.supplier.id) '
	//        'AND h.status="Hoan thanh"';

	try {
		var rc = f.doSelect(query);

		while (rc == RC_SUCCESS) {

			var supplierId = f["supplier.id"];
			var supplierName = f["supplier.name"];

			suppliers.push({
				id: supplierId,
				name: supplierName
			});

			rc = f.getNext();
		}

		return resultObj;
	} finally {
		if (f) {
			f.doClose();
		}

	}
}

function getExpiryWarningReceivers(record) {
	var receivers = [];
	var emailMap = {};

	function addReceiver(contactId) {
		if (!contactId) {
			return;
		}
		var query = 'contact.name="' + contactId + '"';
		var email = getCommonName("contacts", query, "email");
		if (!email || emailMap[email]) {
			return;
		}
		emailMap[email] = true;
		receivers.push({
			email: email,
			name: getCommonName("contacts", query, "full.name")
		});
	}

	// Người theo dõi thực hiện HĐ/KMSTT
	addReceiver(record.executor_id);

	return receivers;
}