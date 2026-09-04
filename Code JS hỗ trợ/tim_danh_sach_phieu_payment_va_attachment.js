/**
 * =============================================================================
 * SCRIPT TÌM DANH SÁCH MÃ PHIẾU THANH TOÁN & ATTACHMENT ĐANG CÓ TRÊN DATABASE
 * =============================================================================
 *
 * Chạy script này trong JavaScript Test để:
 * 1. Xem 10 mã phiếu thanh toán (esdHTKTpayment) gần nhất đang có thực tế trên DB.
 * 2. Xem các bản ghi trình ký (esdHTKTpaymentAttachment) đang có trong DB.
 * 3. Lấy đúng mã phiếu thật để dán vào script chẩn đoán hoặc test màn hình ký số/in phiếu.
 * =============================================================================
 */

listAvailablePaymentRecords();

function listAvailablePaymentRecords() {
	print("\n================================================================================");
	print("  DANH SÁCH 10 PHIẾU THANH TOÁN (esdHTKTpayment) GẦN NHẤT TRÊN DB");
	print("================================================================================");

	var payList = [];
	try {
		var payFile = new SCFile("esdHTKTpayment", SCFILE_READONLY);
		var rcPay = payFile.doSelect("true");
		var count = 0;

		while (rcPay === RC_SUCCESS && count < 10) {
			count++;
			var payId = String(payFile.id || "").trim();
			var status = String(payFile.status || "").trim();
			var phase = String(payFile["current.phase"] || payFile.current_phase || "").trim();
			var title = String(payFile.title || payFile.brief_description || "").trim();

			payList.push(payId);
			print("[" + count + "] ID: " + payId + " | Status: " + status + " | Phase: " + phase + " | Title: " + title);
			rcPay = payFile.getNext();
		}
		try { payFile.doClose(); } catch (e) {}

		if (count === 0) {
			print("⚠️ Bảng esdHTKTpayment hoàn toàn TRỐNG (chưa có bản ghi nào trên DB này)!");
		}
	} catch (ePay) {
		print("❌ Lỗi truy vấn bảng esdHTKTpayment: " + ePay);
	}

	print("\n================================================================================");
	print("  DANH SÁCH 10 BẢN GHI TRÌNH KÝ (esdHTKTpaymentAttachment) TRÊN DB");
	print("================================================================================");

	try {
		var attFile = new SCFile("esdHTKTpaymentAttachment", SCFILE_READONLY);
		var rcAtt = attFile.doSelect("true");
		var countAtt = 0;

		while (rcAtt === RC_SUCCESS && countAtt < 10) {
			countAtt++;
			var attId = String(attFile.id || "").trim();
			var paymentId = String(attFile["payment.id"] || "").trim();
			var name = String(attFile.name || "").trim();
			var type = String(attFile.type || "").trim();
			var status = String(attFile.status || "").trim();
			var ecmObjectId = String(attFile["ecm.object.id"] || "").trim();
			var ecmDocId = String(attFile["ecm.doc.id"] || "").trim();

			print("[" + countAtt + "] ID: " + attId + " | payment.id: " + paymentId + " | Name: " + name + " | type: " + type + " | status: " + status + " | ecmObjectId: " + ecmObjectId);
			rcAtt = attFile.getNext();
		}
		try { attFile.doClose(); } catch (e) {}

		if (countAtt === 0) {
			print("⚠️ Bảng esdHTKTpaymentAttachment hoàn toàn TRỐNG (chưa có file trình ký nào được lưu)!");
		}
	} catch (eAtt) {
		print("❌ Lỗi truy vấn bảng esdHTKTpaymentAttachment: " + eAtt);
	}

	print("================================================================================\n");
}
