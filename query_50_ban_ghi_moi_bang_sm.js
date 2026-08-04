/**
 * Lay toi da 50 ban ghi moi bang trong Service Manager.
 * Khong loc theo paymentId/prepaymentId. Chi doc, khong ghi DB.
 * Chay truc tiep toan bo script trong SM JavaScript Test/ScriptLibrary.
 */

var MAX_ROWS = 50;

var TABLES = [
  {
    name: 'esdHTKTpayment',
    fields: ['id', 'department', 'description', 'current.phase', 'created.by',
      'total.advance.amount', 'total.amount.paid', 'total.refund.amount', 'currentcy']
  },
  {
    name: 'esdHTKTpaymentVendor',
    fields: ['payment.id', 'vendor.id', 'vendor.site.id', 'approved.invoice.amount',
      'amount', 'refund.amount', 'vendor.type', 'currency', 'payment.method',
      'beneficiary.account', 'beneficiary.name', 'beneficiary.bank', 'exchange.rate',
      'payment.rate']
  },
  {
    name: 'esdHTKTpaymentInvoice',
    fields: ['payment.id', 'invoice.id', 'deduction.type', 'deduction.amount', 'deduction.rate']
  },
  {
    name: 'esdHTKTpaymentCostDivision',
    fields: ['id', 'payment.id', 'vendor.id', 'account.number', 'account.name',
      'amount.before.tax', 'amount.after.tax', 'currency', 'department',
      'department.name', 'branch', 'description', 'order']
  },
  {
    name: 'esdHTKTpaymentEntry',
    fields: entryFields('payment.id')
  },
  {
    name: 'esdHTKTprepayment',
    fields: ['id', 'department', 'description', 'current.phase', 'created.by',
      'user.checker.kttc', 'initial.role']
  },
  {
    name: 'esdHTKTprepaymentVendor',
    fields: ['prepayment.id', 'vendor.id', 'vendor.site.id', 'amount', 'currency',
      'payment.method', 'beneficiary.account', 'beneficiary.name', 'beneficiary.bank']
  },
  {
    name: 'esdHTKTprepaymentInvoice',
    fields: ['prepayment.id', 'invoice.id', 'deduction.type']
  },
  {
    name: 'esdHTKTprepaymentEntry',
    fields: entryFields('prepayment.id')
  },
  {
    name: 'esdHTKTinvoice',
    fields: ['id', 'total.tax', 'exchange.rate', 'seller.tax.code']
  },
  {
    name: 'esdHTKTvendor',
    fields: ['id', 'vendor.name', 'vendor.number']
  },
  {
    name: 'esdHTKTvendorSite',
    fields: ['id', 'ogl.site.code', 'debit.account', 'credit.account']
  },
  {
    name: 'esdDMcategoryItems',
    fields: ['category.id', 'item.id', 'item.name']
  },
  {
    name: 'esdDMglAccount',
    fields: ['account', 'name', 'account.type', 'apply.currency']
  },
  {
    name: 'contacts',
    fields: ['contact.name', 'lv1.id']
  },
  {
    name: 'esdDMentity',
    fields: ['ps.code', 'entity.code', 'ogl.branch.code', 'org.transaction.code', 'branch.name']
  },
  {
    name: 'esdQTorgUnit',
    fields: ['unit.id', 'unit.name', 'parent.id']
  },
  {
    name: 'esdDMbank',
    fields: ['bank.code', 'name']
  },
  {
    name: 'esdDMcostCenter',
    fields: ['org.code', 'cost.center', 'name']
  }
];

run();

function run() {
  var result = {
    success: true,
    maxRowsPerTable: MAX_ROWS,
    counts: {},
    tables: {},
    errors: []
  };

  for (var i = 0; i < TABLES.length; i++) {
    var definition = TABLES[i];
    var rows = selectTopRows(definition.name, definition.fields, MAX_ROWS, result.errors);
    result.tables[definition.name] = rows;
    result.counts[definition.name] = rows.length;
  }

  result.success = result.errors.length === 0;
  var output = JSON.stringify(result);

  /* Xem ket qua trong log JavaScript. */
  try { print(output); } catch (ignorePrint) {}

  /* Neu script duoc goi qua $L.file thi tra them vao queryReturn. */
  try {
    if (vars['$L.file']) vars['$L.file'].queryReturn = output;
  } catch (ignoreOutput) {}

  return result;
}

function selectTopRows(tableName, fields, maxRows, errors) {
  var rows = [];
  var file = null;
  var rc;

  try {
    file = new SCFile(tableName, SCFILE_READONLY);
    rc = file.doSelect('true');

    while (rc === RC_SUCCESS && rows.length < maxRows) {
      var row = {};
      for (var i = 0; i < fields.length; i++) {
        row[fields[i]] = readField(file, fields[i]);
      }
      rows.push(row);
      rc = file.getNext();
    }
  } catch (e) {
    errors.push({ table: tableName, error: e.toString() });
  }

  closeFile(file);
  return rows;
}

function entryFields(parentField) {
  return [
    'id', parentField, 'entry.type', 'ledger.type', 'account.type',
    'account.number', 'account.name', 'branch', 'department', 'transaction.code',
    'amount', 'currency', 'description', 'vendor.id', 'type', 'order',
    'accounting.request.id'
  ];
}

function readField(record, fieldName) {
  try {
    var value = record[fieldName];
    return value === null || value === undefined ? '' : value;
  } catch (e) {
    return '';
  }
}

function closeFile(file) {
  try { if (file) file.close(); } catch (ignore) {}
}
