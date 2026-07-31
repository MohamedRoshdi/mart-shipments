// يُلصق صاحب المحل إعدادات Firebase هنا (راجع SETUP.md)
window.FIREBASE_CONFIG = {
  projectId: "shipments-alaela-mart",
  appId: "1:430785723659:web:e251741482c3c42b12b60e",
  storageBucket: "shipments-alaela-mart.firebasestorage.app",
  apiKey: "AIzaSyDWJTWWn89mS8nvDQfLWc4hxCaFyBtnttQ",
  authDomain: "shipments-alaela-mart.firebaseapp.com",
  messagingSenderId: "430785723659"
};
// القيم دي هي الأساس. لو الأدمن غيّر الإعدادات من صفحة النظام، اللي في قاعدة البيانات
// بيغلب اللي هنا — ما عدا رقم الأدمن اللي تحت: بيفضل شغال دايمًا كصمام أمان ضد القفل.
window.APP_CONFIG = {
  adminPin: '7007',                   // الأدمن: الإعدادات + آخر العمليات + الأدوات الخطرة
  managerPin: '1994',                 // يشوف كل الفروع
  branches: [
    { name: 'فرع قويسنا' },
    { name: 'فرع شبين الكوم' }
  ],
  shipmentTypes: ['إذن استلام', 'إذن مرتجع', 'تحويل فرع'],
  suppliers: []                       // أسماء الموردين — بتتكتب من صفحة النظام وبتظهر كاقتراح لاسم الشحنة
};
