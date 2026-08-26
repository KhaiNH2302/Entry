var callRuleSet = lib.ESD_Utils.callRuleSet;
var getCommonName = lib.ESD_Utils.getCommonName;
var getFieldsContactsByRightsAndFilter = lib.ESD_PERMS_RIGHTS ? lib.ESD_PERMS_RIGHTS.getFieldsContactsByRightsAndFilter : null;

/**
 * Danh sách mã Template Email dự kiến cho phân hệ Thanh toán (Payment)
 */
var emailList = {
	"YeuCauPheDuyet": "TEM_TT01",   // Yêu cầu xác nhận / phê duyệt hồ sơ thanh toán
	"YeuCauChinhSua": "TEM_TT02",   // Yêu cầu chỉnh sửa / từ chối hồ sơ thanh toán
	"PheDuyet":       "TEM_TT03",   // Hồ sơ thanh toán đã được phê duyệt / hoàn tất ký số
	"HoanThanhChi":   "TEM_TT04",   // Thông báo hoàn tất hạch toán / chuyển tiền
	"CanhBaoHanTT":   "TEM_TT05"    // Cảnh báo sắp đến hạn thanh toán
};

function getEmailList() {
	return emailList;
}

// ===== HÀM DỌN DẸP BIẾN TOÀN CỤC =====
function cleanGlobalVariable() {
	vars["$G.mail.receiver"] = null;
	vars["$G.mail.receiver.name"] = null;
	vars["$G.mail.tem"] = null;
}

// ===== HÀM GỬI EMAIL CHUẨN DÙNG CHUNG =====
function sendMailPayment(record, user, template) {
	if (!record || !user || !user.email) {
		return false;
	}
	try {
		vars["$G.mail.receiver"] = [user.email];
		vars["$G.mail.receiver.name"] = user["full.name"] || user.fullName || "";
		vars["$G.mail.tem"] = template;

		callRuleSet(record, "ESD_HTKT_PAYMENT_SENDEMAIL");
		return true;
	} catch (e) {
		print("[ESD_HTKT_PAYMENT_ACTION_WF_SendEmail.sendMailPayment] Error: " + e);
		return false;
	} finally {
		cleanGlobalVariable();
	}
}

/**
 * 1. Gửi email thông báo cho Người tạo hồ sơ (Owner)
 */
function sendMailToOwner(record, template) {
	if (!record || (!record["created.by"] && !record.created_by)) {
		return false;
	}
	var createdBy = record["created.by"] || record.created_by;
	var userOwner = lib.ESD_Utils.getOneRecord("contacts", 'contact.name="' + createdBy + '"', ["email", "full.name"]);
	if (userOwner && userOwner.email) {
		return sendMailPayment(record, userOwner, template);
	}
	return false;
}

/**
 * 2. Gửi email yêu cầu phê duyệt cho Người duyệt kế tiếp (Next Approver)
 */
function sendMailToApprover(record, approverContactId) {
	var targetContact = approverContactId || record["next.approver"] || record.next_approver;
	if (!targetContact) {
		return false;
	}
	var approver = lib.ESD_Utils.getOneRecord("contacts", 'contact.name="' + targetContact + '"', ["email", "full.name"]);
	if (approver && approver.email) {
		return sendMailPayment(record, approver, emailList.YeuCauPheDuyet);
	}
	return false;
}

/**
 * 3. Gửi email thông báo yêu cầu chỉnh sửa hồ sơ thanh toán
 */
function sendMailYeuCauChinhSua(record) {
	return sendMailToOwner(record, emailList.YeuCauChinhSua);
}

/**
 * 4. Gửi email thông báo hồ sơ thanh toán đã được phê duyệt
 */
function sendMailPheDuyet(record) {
	return sendMailToOwner(record, emailList.PheDuyet);
}

/**
 * 5. Gửi email thông báo đã thực chi / hạch toán thành công
 */
function sendMailHoanThanhChiTien(record) {
	// Gửi cho người lập hồ sơ
	sendMailToOwner(record, emailList.HoanThanhChi);

	// Tùy chọn: Nếu cần gửi cho người theo dõi hợp đồng liên quan
	if (record.contract_id) {
		var contractExecutor = getCommonName("esdHDcontract", 'id="' + record.contract_id + '"', "executor.id");
		if (contractExecutor) {
			var executorContact = lib.ESD_Utils.getOneRecord("contacts", 'contact.name="' + contractExecutor + '"', ["email", "full.name"]);
			if (executorContact) {
				sendMailPayment(record, executorContact, emailList.HoanThanhChi);
			}
		}
	}
}

/**
 * 6. Gửi danh sách người nhận theo mảng Contacts
 */
function sendEmailToUsers(record, template, contacts) {
	if (!record || !template || !contacts) {
		return false;
	}
	if (!Array.isArray(contacts)) {
		contacts = [contacts];
	}
	// Lọc bỏ rỗng và trùng lặp
	var uniqueContacts = Array.from(new Set(contacts.filter(function(c) { return c; })));
	for (var i = 0; i < uniqueContacts.length; i++) {
		var contact = lib.ESD_Utils.getOneRecord("contacts", 'contact.name="' + uniqueContacts[i] + '"', ["email", "full.name"]);
		if (contact && contact.email) {
			sendMailPayment(record, contact, template);
		}
	}
	return true;
}
