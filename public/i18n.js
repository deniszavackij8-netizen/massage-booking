// Переводы сайта: русский, английский, грузинский.
//
// Как это работает: у элементов страницы есть атрибут data-i18n="ключ" —
// при смене языка их текст подменяется на перевод из словаря ниже.
// Атрибуты (placeholder, aria-label, alt) переводятся через
// data-i18n-attr="placeholder:ключ|aria-label:ключ2".
//
// Чтобы поправить перевод — найдите ключ во всех трёх словарях и
// измените текст. {name} в тексте — это место для подстановки значения.
(function () {
  'use strict';

  var DICT = {
    ru: {
      meta_title: 'Salt & Stone — массаж в Батуми',
      meta_description: 'Онлайн-запись на массаж в Батуми: выберите свободное время и получите подтверждение.',
      language: 'Язык',
      menu: 'Меню',
      nav_services: 'Услуги и цены',
      nav_book: 'Запись онлайн',
      cta_book: 'Записаться',

      hero_eyebrow: 'Массаж · Батуми',
      hero_title_1: 'Запишитесь на массаж',
      hero_title_2: 'онлайн за минуту',
      hero_lead: 'Выберите дату, свободное время и оставьте телефон — мы получим уведомление и подтвердим запись.',
      hero_cta_time: 'Выбрать время',
      hero_cta_wa: 'Написать в WhatsApp',
      hero_img_alt: 'Массаж спины',
      video_pause: 'Остановить видео',
      video_play: 'Включить видео',

      services_eyebrow: 'Услуги и цены',
      services_title: 'Наши массажи',
      services_lead: 'Выберите массаж — и сразу запишитесь на удобное время.',
      services_book: 'Записаться',
      services_loading: 'Загружаем услуги…',
      services_error: 'Не удалось загрузить услуги. Обновите страницу.',
      min: 'мин',

      booking_eyebrow: 'Онлайн-запись',
      booking_title: 'Выберите удобное время',
      booking_lead: 'Занятые слоты показаны серым и недоступны для выбора — двойная запись на одно время исключена.',
      label_name: 'Имя и фамилия',
      ph_name: 'Анна Иванова',
      label_phone: 'Номер телефона',
      label_service: 'Услуга',
      choose_service: 'Выберите услугу',
      label_duration: 'Длительность',
      label_date: 'Дата сеанса',
      label_slots: 'Доступное время',
      slots_loading: 'Загрузка расписания…',
      slots_error: 'Не удалось загрузить расписание. Обновите страницу.',
      slots_none: 'На эту дату свободного времени нет. Выберите другой день.',
      summary_title: 'Проверьте запись',
      summary_service: 'Услуга',
      summary_duration: 'Длительность',
      summary_date: 'Дата',
      summary_time: 'Время',
      summary_price: 'Стоимость',
      btn_choose: 'Выберите услугу, дату и время',
      btn_confirm: 'Подтвердить запись — {price}₾',
      btn_sending: 'Отправляем…',
      val_name_phone: 'Заполните имя и телефон.',
      val_phone: 'Введите номер телефона с кодом страны (7–15 цифр).',
      phone_hint: 'Номер с кодом страны: 995 — Грузия, 7 — Россия',
      val_service: 'Выберите услугу.',
      val_duration: 'Выберите длительность.',
      val_time: 'Выберите время сеанса.',
      err_connection: 'Ошибка соединения с сервером. Попробуйте ещё раз.',

      success_title: 'Вы записаны!',
      success_text: '{date}, {time} · {service}, {min} мин. Мы свяжемся с вами для подтверждения.',
      success_calendar: 'Добавить в календарь',
      success_google: 'Google Календарь',
      success_cancel: 'Отменить запись',
      success_hint: 'Ссылка для отмены есть и в событии календаря. Отменить онлайн можно не позже чем за 3 часа до сеанса.',
      success_again: 'Записаться ещё',

      my_title: 'Ваши записи на этом устройстве',
      my_calendar: 'В календарь',
      my_cancel: 'Отменить',

      address_title: 'Адрес',
      copy: 'Скопировать',
      copied: 'Скопировано ✓',
      copy_manual: 'Выделите и скопируйте',
      on_map: 'На карте',
      hours_title: 'Часы работы',
      every_day: 'Ежедневно',
      contact_title: 'Связаться напрямую',
      footer_city: 'Батуми',

      wa_label: 'Написать в WhatsApp',
      wa_text: 'Здравствуйте! Хочу записаться на массаж',

      cal_title: 'Массаж — Salt & Stone',
      cal_cancel: 'Отменить запись (не позже чем за 3 часа)',

      cancel_meta_title: 'Отмена записи — Salt & Stone',
      cancel_title: 'Отмена записи',
      cancel_loading: 'Загружаем запись…',
      cancel_your: 'Ваша запись',
      cancel_deadline: 'Отменить онлайн можно до {deadline}',
      cancel_confirm: 'Да, отменить запись',
      cancel_cancelling: 'Отменяем…',
      cancel_done: 'Запись отменена. Время снова свободно для других.',
      cancel_invalid: 'Ссылка недействительна или запись уже отменена.',
      cancel_too_late: 'Отменить онлайн можно не позже чем за 3 часа до сеанса. Пожалуйста, напишите нам в WhatsApp.',
      cancel_back: 'Вернуться на сайт',
      cancel_again: 'Записаться снова',

      err_bad_fields: 'Заполните имя, телефон, дату, время и выберите услугу.',
      err_bad_name: 'Укажите имя (от 2 до 120 символов, без ссылок).',
      err_bad_phone: 'Укажите корректный номер телефона.',
      err_bad_date: 'Некорректная дата.',
      err_too_far: 'Запись открыта не больше чем на 60 дней вперёд.',
      err_bad_time: 'Некорректное время сеанса.',
      err_bad_service: 'Некорректная услуга или длительность.',
      err_not_enough_time: 'Для такой длительности не хватает времени до конца рабочего дня. Выберите время пораньше.',
      err_too_soon: 'Это время уже прошло или наступает меньше чем через час. Выберите другое время.',
      err_day_closed: 'В этот день запись закрыта. Выберите другую дату.',
      err_slot_taken: 'Это время уже занято. Выберите другое.',
      err_phone_limit: 'На этот номер уже есть несколько активных записей. Для новой записи напишите нам в WhatsApp или Telegram.',
      err_busy: 'Онлайн-запись временно перегружена. Пожалуйста, напишите нам в WhatsApp или Telegram.',
      err_rate_limited: 'Слишком много попыток подряд. Подождите немного и попробуйте снова.',
      err_bad_request: 'Некорректный запрос.',
      err_server_error: 'Ошибка сервера. Попробуйте позже.',
      err_not_found: 'Запись не найдена — возможно, она уже отменена.',
      err_too_late: 'Отменить онлайн можно не позже чем за 3 часа до сеанса. Пожалуйста, напишите нам в WhatsApp.'
    },

    en: {
      meta_title: 'Salt & Stone — massage in Batumi',
      meta_description: 'Book a massage in Batumi online: pick a free time and get a confirmation.',
      language: 'Language',
      menu: 'Menu',
      nav_services: 'Services & prices',
      nav_book: 'Book online',
      cta_book: 'Book now',

      hero_eyebrow: 'Massage · Batumi',
      hero_title_1: 'Book a massage',
      hero_title_2: 'online in a minute',
      hero_lead: 'Pick a date and a free time, leave your phone number — we’ll get notified and confirm your booking.',
      hero_cta_time: 'Choose a time',
      hero_cta_wa: 'Message us on WhatsApp',
      hero_img_alt: 'Back massage',
      video_pause: 'Pause video',
      video_play: 'Play video',

      services_eyebrow: 'Services & prices',
      services_title: 'Our massages',
      services_lead: 'Choose a massage and book a convenient time right away.',
      services_book: 'Book',
      services_loading: 'Loading services…',
      services_error: 'Couldn’t load services. Please refresh the page.',
      min: 'min',

      booking_eyebrow: 'Online booking',
      booking_title: 'Choose a convenient time',
      booking_lead: 'Booked times are greyed out and can’t be selected — no double bookings.',
      label_name: 'Full name',
      ph_name: 'Anna Smith',
      label_phone: 'Phone number',
      label_service: 'Service',
      choose_service: 'Choose a service',
      label_duration: 'Duration',
      label_date: 'Date',
      label_slots: 'Available times',
      slots_loading: 'Loading schedule…',
      slots_error: 'Couldn’t load the schedule. Please refresh the page.',
      slots_none: 'No free times on this date. Please choose another day.',
      summary_title: 'Check your booking',
      summary_service: 'Service',
      summary_duration: 'Duration',
      summary_date: 'Date',
      summary_time: 'Time',
      summary_price: 'Price',
      btn_choose: 'Choose a service, date and time',
      btn_confirm: 'Confirm booking — {price}₾',
      btn_sending: 'Sending…',
      val_name_phone: 'Please enter your name and phone number.',
      val_phone: 'Enter your phone number with the country code (7–15 digits).',
      phone_hint: 'Include the country code, e.g. 995 for Georgia, 44 for the UK',
      val_service: 'Please choose a service.',
      val_duration: 'Please choose a duration.',
      val_time: 'Please choose a time.',
      err_connection: 'Connection error. Please try again.',

      success_title: 'You’re booked!',
      success_text: '{date}, {time} · {service}, {min} min. We’ll contact you to confirm.',
      success_calendar: 'Add to calendar',
      success_google: 'Google Calendar',
      success_cancel: 'Cancel booking',
      success_hint: 'The cancellation link is also saved in the calendar event. You can cancel online up to 3 hours before your session.',
      success_again: 'Book another',

      my_title: 'Your bookings on this device',
      my_calendar: 'Calendar',
      my_cancel: 'Cancel',

      address_title: 'Address',
      copy: 'Copy',
      copied: 'Copied ✓',
      copy_manual: 'Select and copy',
      on_map: 'On the map',
      hours_title: 'Opening hours',
      every_day: 'Every day',
      contact_title: 'Contact us directly',
      footer_city: 'Batumi',

      wa_label: 'Message us on WhatsApp',
      wa_text: 'Hello! I’d like to book a massage',

      cal_title: 'Massage — Salt & Stone',
      cal_cancel: 'Cancel booking (at least 3 hours before)',

      cancel_meta_title: 'Cancel booking — Salt & Stone',
      cancel_title: 'Cancel booking',
      cancel_loading: 'Loading your booking…',
      cancel_your: 'Your booking',
      cancel_deadline: 'Online cancellation is available until {deadline}',
      cancel_confirm: 'Yes, cancel my booking',
      cancel_cancelling: 'Cancelling…',
      cancel_done: 'Your booking has been cancelled. The time is free again for others.',
      cancel_invalid: 'This link is invalid or the booking has already been cancelled.',
      cancel_too_late: 'Online cancellation is possible up to 3 hours before the session. Please message us on WhatsApp.',
      cancel_back: 'Back to the website',
      cancel_again: 'Book again',

      err_bad_fields: 'Please fill in your name, phone, date, time and choose a service.',
      err_bad_name: 'Please enter your name (2–120 characters, no links).',
      err_bad_phone: 'Please enter a valid phone number.',
      err_bad_date: 'Invalid date.',
      err_too_far: 'Bookings are open up to 60 days ahead.',
      err_bad_time: 'Invalid time.',
      err_bad_service: 'Invalid service or duration.',
      err_not_enough_time: 'Not enough time before closing for this duration. Please choose an earlier time.',
      err_too_soon: 'This time has passed or is less than an hour away. Please choose another time.',
      err_day_closed: 'Booking is closed on this day. Please choose another date.',
      err_slot_taken: 'This time is already taken. Please choose another one.',
      err_phone_limit: 'This phone number already has several upcoming bookings. To book more, message us on WhatsApp or Telegram.',
      err_busy: 'Online booking is temporarily overloaded. Please message us on WhatsApp or Telegram.',
      err_rate_limited: 'Too many attempts. Please wait a little and try again.',
      err_bad_request: 'Invalid request.',
      err_server_error: 'Server error. Please try again later.',
      err_not_found: 'Booking not found — it may have already been cancelled.',
      err_too_late: 'Online cancellation is possible up to 3 hours before the session. Please message us on WhatsApp.'
    },

    ka: {
      meta_title: 'Salt & Stone — მასაჟი ბათუმში',
      meta_description: 'ონლაინ ჩაწერა მასაჟზე ბათუმში: აირჩიეთ თავისუფალი დრო და მიიღეთ დადასტურება.',
      language: 'ენა',
      menu: 'მენიუ',
      nav_services: 'სერვისები და ფასები',
      nav_book: 'ონლაინ ჩაწერა',
      cta_book: 'ჩაწერა',

      hero_eyebrow: 'მასაჟი · ბათუმი',
      hero_title_1: 'ჩაეწერეთ მასაჟზე',
      hero_title_2: 'ონლაინ, ერთ წუთში',
      hero_lead: 'აირჩიეთ თარიღი და თავისუფალი დრო, დატოვეთ ტელეფონის ნომერი — მივიღებთ შეტყობინებას და დაგიდასტურებთ ჩაწერას.',
      hero_cta_time: 'დროის არჩევა',
      hero_cta_wa: 'მოგვწერეთ WhatsApp-ში',
      hero_img_alt: 'ზურგის მასაჟი',
      video_pause: 'ვიდეოს შეჩერება',
      video_play: 'ვიდეოს ჩართვა',

      services_eyebrow: 'სერვისები და ფასები',
      services_title: 'ჩვენი მასაჟები',
      services_lead: 'აირჩიეთ მასაჟი და მაშინვე ჩაეწერეთ თქვენთვის სასურველ დროზე.',
      services_book: 'ჩაწერა',
      services_loading: 'სერვისები იტვირთება…',
      services_error: 'სერვისების ჩატვირთვა ვერ მოხერხდა. განაახლეთ გვერდი.',
      min: 'წთ',

      booking_eyebrow: 'ონლაინ ჩაწერა',
      booking_title: 'აირჩიეთ სასურველი დრო',
      booking_lead: 'დაკავებული დრო ნაცრისფრადაა მონიშნული და მისი არჩევა შეუძლებელია — ორმაგი ჩაწერა გამორიცხულია.',
      label_name: 'სახელი და გვარი',
      ph_name: 'ანა ბერიძე',
      label_phone: 'ტელეფონის ნომერი',
      label_service: 'სერვისი',
      choose_service: 'აირჩიეთ სერვისი',
      label_duration: 'ხანგრძლივობა',
      label_date: 'სეანსის თარიღი',
      label_slots: 'თავისუფალი დრო',
      slots_loading: 'განრიგი იტვირთება…',
      slots_error: 'განრიგის ჩატვირთვა ვერ მოხერხდა. განაახლეთ გვერდი.',
      slots_none: 'ამ დღეს თავისუფალი დრო აღარ არის. აირჩიეთ სხვა დღე.',
      summary_title: 'შეამოწმეთ ჩანაწერი',
      summary_service: 'სერვისი',
      summary_duration: 'ხანგრძლივობა',
      summary_date: 'თარიღი',
      summary_time: 'დრო',
      summary_price: 'ღირებულება',
      btn_choose: 'აირჩიეთ სერვისი, თარიღი და დრო',
      btn_confirm: 'ჩაწერის დადასტურება — {price}₾',
      btn_sending: 'იგზავნება…',
      val_name_phone: 'შეიყვანეთ სახელი და ტელეფონის ნომერი.',
      val_phone: 'შეიყვანეთ ტელეფონის ნომერი ქვეყნის კოდით (7–15 ციფრი).',
      phone_hint: 'ქვეყნის კოდით, მაგ. 995 — საქართველო',
      val_service: 'აირჩიეთ სერვისი.',
      val_duration: 'აირჩიეთ ხანგრძლივობა.',
      val_time: 'აირჩიეთ სეანსის დრო.',
      err_connection: 'კავშირის შეცდომა. სცადეთ თავიდან.',

      success_title: 'თქვენ ჩაწერილი ხართ!',
      success_text: '{date}, {time} · {service}, {min} წთ. დასადასტურებლად დაგიკავშირდებით.',
      success_calendar: 'კალენდარში დამატება',
      success_google: 'Google Calendar',
      success_cancel: 'ჩაწერის გაუქმება',
      success_hint: 'გაუქმების ბმული კალენდრის ღონისძიებაშიც ინახება. ონლაინ გაუქმება შესაძლებელია სეანსამდე არაუგვიანეს 3 საათისა.',
      success_again: 'კიდევ ჩაწერა',

      my_title: 'თქვენი ჩანაწერები ამ მოწყობილობაზე',
      my_calendar: 'კალენდარი',
      my_cancel: 'გაუქმება',

      address_title: 'მისამართი',
      copy: 'კოპირება',
      copied: 'დაკოპირდა ✓',
      copy_manual: 'მონიშნეთ და დააკოპირეთ',
      on_map: 'რუკაზე',
      hours_title: 'სამუშაო საათები',
      every_day: 'ყოველდღე',
      contact_title: 'დაგვიკავშირდით პირდაპირ',
      footer_city: 'ბათუმი',

      wa_label: 'მოგვწერეთ WhatsApp-ში',
      wa_text: 'გამარჯობა! მინდა მასაჟზე ჩაწერა',

      cal_title: 'მასაჟი — Salt & Stone',
      cal_cancel: 'ჩაწერის გაუქმება (სეანსამდე არაუგვიანეს 3 საათისა)',

      cancel_meta_title: 'ჩაწერის გაუქმება — Salt & Stone',
      cancel_title: 'ჩაწერის გაუქმება',
      cancel_loading: 'ჩანაწერი იტვირთება…',
      cancel_your: 'თქვენი ჩანაწერი',
      cancel_deadline: 'ონლაინ გაუქმების ბოლო ვადა: {deadline}',
      cancel_confirm: 'დიახ, გააუქმეთ ჩანაწერი',
      cancel_cancelling: 'უქმდება…',
      cancel_done: 'ჩანაწერი გაუქმებულია. დრო ისევ თავისუფალია სხვებისთვის.',
      cancel_invalid: 'ბმული არასწორია ან ჩანაწერი უკვე გაუქმებულია.',
      cancel_too_late: 'ონლაინ გაუქმება შესაძლებელია სეანსამდე არაუგვიანეს 3 საათისა. გთხოვთ, მოგვწეროთ WhatsApp-ში.',
      cancel_back: 'საიტზე დაბრუნება',
      cancel_again: 'ხელახლა ჩაწერა',

      err_bad_fields: 'გთხოვთ, შეავსოთ სახელი, ტელეფონი, თარიღი, დრო და აირჩიოთ სერვისი.',
      err_bad_name: 'მიუთითეთ სახელი (2–120 სიმბოლო, ბმულების გარეშე).',
      err_bad_phone: 'მიუთითეთ სწორი ტელეფონის ნომერი.',
      err_bad_date: 'არასწორი თარიღი.',
      err_too_far: 'ჩაწერა შესაძლებელია მაქსიმუმ 60 დღით ადრე.',
      err_bad_time: 'არასწორი დრო.',
      err_bad_service: 'არასწორი სერვისი ან ხანგრძლივობა.',
      err_not_enough_time: 'ამ ხანგრძლივობისთვის სამუშაო დღის ბოლომდე დრო არ არის საკმარისი. აირჩიეთ უფრო ადრეული დრო.',
      err_too_soon: 'ეს დრო უკვე გავიდა ან დაწყებამდე ერთ საათზე ნაკლებია დარჩენილი. აირჩიეთ სხვა დრო.',
      err_day_closed: 'ამ დღეს ჩაწერა დახურულია. აირჩიეთ სხვა თარიღი.',
      err_slot_taken: 'ეს დრო უკვე დაკავებულია. აირჩიეთ სხვა.',
      err_phone_limit: 'ამ ნომერზე უკვე რამდენიმე აქტიური ჩანაწერია. ახალი ჩაწერისთვის მოგვწერეთ WhatsApp-ში ან Telegram-ში.',
      err_busy: 'ონლაინ ჩაწერა დროებით გადატვირთულია. გთხოვთ, მოგვწეროთ WhatsApp-ში ან Telegram-ში.',
      err_rate_limited: 'ძალიან ბევრი მცდელობაა. ცოტა მოიცადეთ და სცადეთ თავიდან.',
      err_bad_request: 'არასწორი მოთხოვნა.',
      err_server_error: 'სერვერის შეცდომა. სცადეთ მოგვიანებით.',
      err_not_found: 'ჩანაწერი ვერ მოიძებნა — შესაძლოა, უკვე გაუქმებულია.',
      err_too_late: 'ონლაინ გაუქმება შესაძლებელია სეანსამდე არაუგვიანეს 3 საათისა. გთხოვთ, მოგვწეროთ WhatsApp-ში.'
    }
  };

  var LANGS = ['ru', 'en', 'ka'];
  var LOCALES = { ru: 'ru-RU', en: 'en-GB', ka: 'ka-GE' };
  var STORAGE_KEY = 'ss_lang';
  var listeners = [];

  function safeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* приватный режим — не страшно */ }
  }

  // Язык выбирается так: ?lang=en в адресе → ранее выбранный вручную →
  // язык телефона/браузера. Грузинский → ka, русский и близкие → ru,
  // всё остальное → английский (туристы со всего мира).
  function detect() {
    try {
      var fromUrl = new URLSearchParams(window.location.search).get('lang');
      if (LANGS.indexOf(fromUrl) !== -1) return fromUrl;
    } catch (e) { /* старый браузер */ }

    var saved = safeGet(STORAGE_KEY);
    if (LANGS.indexOf(saved) !== -1) return saved;

    var prefs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ''];
    for (var i = 0; i < prefs.length; i++) {
      var code = String(prefs[i] || '').toLowerCase().split('-')[0];
      if (code === 'ka') return 'ka';
      if (code === 'ru' || code === 'uk' || code === 'be' || code === 'kk' || code === 'ky') return 'ru';
      if (code === 'en') return 'en';
    }
    return 'en';
  }

  var current = detect();

  function t(key, vars) {
    var dict = DICT[current] || DICT.ru;
    var text = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : (DICT.ru[key] || key);
    if (vars) {
      text = text.replace(/\{(\w+)\}/g, function (m, name) {
        return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m;
      });
    }
    return text;
  }

  function apply(root) {
    var scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    scope.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      el.getAttribute('data-i18n-attr').split('|').forEach(function (pair) {
        var parts = pair.split(':');
        if (parts.length === 2) el.setAttribute(parts[0].trim(), t(parts[1].trim()));
      });
    });
    document.documentElement.lang = current;
    document.querySelectorAll('[data-lang]').forEach(function (btn) {
      var active = btn.getAttribute('data-lang') === current;
      btn.classList.toggle('lang-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function setLang(lang) {
    if (LANGS.indexOf(lang) === -1 || lang === current) return;
    current = lang;
    safeSet(STORAGE_KEY, lang);
    apply();
    listeners.forEach(function (fn) { fn(lang); });
  }

  function onChange(fn) { listeners.push(fn); }

  // Перевод ошибки от сервера: по коду, иначе — текст сервера (он по-русски).
  function errorMessage(data, fallbackKey) {
    if (data && data.code && Object.prototype.hasOwnProperty.call(DICT.ru, 'err_' + data.code)) {
      return t('err_' + data.code);
    }
    return t(fallbackKey || 'err_server_error');
  }

  function serviceName(service) {
    if (!service) return '';
    return (service.names && service.names[current]) || service.name || '';
  }

  // «суббота, 18 октября» на языке посетителя. Дату считаем «календарной»
  // (без часового пояса), чтобы у туриста из другой страны она не съехала.
  function formatDate(isoDate, withWeekday) {
    var p = String(isoDate).split('-').map(Number);
    if (p.length !== 3 || p.some(isNaN)) return isoDate;
    var opts = { timeZone: 'UTC', day: 'numeric', month: 'long' };
    if (withWeekday !== false) opts.weekday = 'long';
    try {
      return new Intl.DateTimeFormat(LOCALES[current], opts).format(new Date(Date.UTC(p[0], p[1] - 1, p[2])));
    } catch (e) {
      return isoDate;
    }
  }

  // Момент времени → «18 октября, 09:00» по часам салона (Батуми).
  function formatDateTime(isoInstant) {
    try {
      return new Intl.DateTimeFormat(LOCALES[current], {
        timeZone: 'Asia/Tbilisi', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false
      }).format(new Date(isoInstant));
    } catch (e) {
      return isoInstant;
    }
  }

  // Переключатель языка — кнопки с атрибутом data-lang.
  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-lang]') : null;
    if (btn) setLang(btn.getAttribute('data-lang'));
  });

  window.I18N = {
    t: t,
    apply: apply,
    setLang: setLang,
    onChange: onChange,
    errorMessage: errorMessage,
    serviceName: serviceName,
    formatDate: formatDate,
    formatDateTime: formatDateTime,
    get lang() { return current; }
  };
})();
