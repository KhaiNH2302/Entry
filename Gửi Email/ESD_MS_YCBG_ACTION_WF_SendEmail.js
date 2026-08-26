var YCBGapprovalLevel = lib.ESD_MS_SETUP_CONST.getYCBGapprovalLevel();
var callRuleSet = lib.ESD_Utils.callRuleSet;

var emailList = {
	"YeuCauXacNhan": "TEM014",
	"YeuCauPheDuyet": "TEM015",
	"XacNhan": "TEM016",
	"YeuCauChinhSua": "TEM017",
	"PheDuyet": "TEM018"
}

function getEmailList() {
	return emailList;
}

// ===== SEND MAIL =====
function sendMail(record, user, template) {
	vars["$G.mail.receiver"] = [user.email];
	vars["$G.mail.receiver.name"] = user["full.name"];
	vars["$G.mail.tem"] = template;

	callRuleSet(record, "ESD_MS_YCBG_SENDEMAIL");
	cleanGlobalVariable();
}

function cleanGlobalVariable() {
	vars["$G.mail.receiver"] = null;
	vars["$G.mail.receiver.name"] = null;
	vars["$G.mail.tem"] = null;
}

function sendMailToTCGMS(record) {
	const file = new SCFile("esdMSkmsApproval");
	try {
		//join table esdMSkmsApproval with contacts
		let rc = file.doSelect(
				`SELECT a.approver.id AS approver.id, c.email AS email, c.full.name AS full.name FROM esdMSkmsApproval a INNER JOIN contacts c ON (a.approver.id = c.contact.name) WHERE a.parent.id="${record.id}" AND a.approval.level="${YCBGapprovalLevel.ToChuyenGiaMS}" AND a.approver.id~="${vars["$lo.contact.name"]}"`
		);
		while (rc == RC_SUCCESS) {
			sendMail(record, file, emailList.YeuCauXacNhan);
			rc = file.getNext();
		}
	} catch (e) {
		print("[ESD_MS_YCBG_ACTION_WF.sendMail] error: " + e);
	} finally {
		if (file) file.doClose();
	}
}

function sendMailToChuDauTu(record) {
	const file = new SCFile("esdMSkmsApproval");
	try {
		//join table esdMSkmsApproval with contacts
		let rc = file.doSelect(
				`SELECT a.approver.id AS approver.id, c.email AS email, c.full.name AS full.name FROM esdMSkmsApproval a INNER JOIN contacts c ON (a.approver.id = c.contact.name) WHERE a.parent.id="${record.id}" AND a.approval.level="${YCBGapprovalLevel.DaiDienChuDauTu}" AND a.approver.id~="${vars["$lo.contact.name"]}"`
		);
		while (rc == RC_SUCCESS) {
			sendMail(record, file, emailList.YeuCauPheDuyet);
			rc = file.getNext();
		}
	} catch (e) {
		print("[ESD_MS_YCBG_ACTION_WF.sendMail] error: " + e);
	} finally {
		if (file) file.doClose();
	}
}

function sendMailToOwner(record, template) {
	const userOwner = lib.ESD_Utils.getOneRecord("contacts", `contact.name="${record["created.by"]}"`, ["email", "full.name"]);
	if (userOwner) {
		sendMail(record, userOwner, template);
	}
}