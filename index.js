/**
 * Created by savely on 21.05.2017.
 */
const cfg = require('./config');

// Подключаемся к базе
const r = require('rethinkdbdash')(cfg.private.rethinkdb);

// Иницируем бота
const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(cfg.private.token, {polling: true});

// Функция для создания сообщения
function getMessage(before, after) {
	// Создаем массивы из строк
	let beforeArr = before.split('\n');
	let afterArr = after.split('\n');

	const added_init = '\n<b>❇️Получено:</b>\n';
	const removed_init = '\n<b>⚠️Утрачено:</b>\n';

	let added = added_init;
	let removed = removed_init;

	for (let i in beforeArr) {
		// Используем флаг, чтобы в конце вложенного цикла понять был ли такой элемент в принципе или нет
		let isExist = false;

		for (let j in afterArr) {
			// Так как нам лень резать сообщение, мы чекаем регулярками наличие /add_
			if (/add_/.exec(beforeArr[i]) && /add_/.exec(afterArr[j])) {
				// Просто берем начала строк, чтобы сравнить одинаковые ли позиции мы сравниваем
				const beforeLineStart = /.+\sx/.exec(beforeArr[i])[0];
				const afterLineStart = /.+\sx/.exec(afterArr[j])[0];

				// Получаем регуляркой имя без лишних /add_
				const beforeName = /\s\s\s(.+)/.exec(beforeArr[i])[1];
				const afterName = /\s\s\s(.+)/.exec(afterArr[j])[1];

				if (beforeLineStart === afterLineStart) {
					// Не забываем про флаг, нашли совпадение -- ставим true
					isExist = true;

					// Получаем регуляркой значения до и после
					const beforeValue = parseInt(/\s\d+/.exec(beforeArr[i]));
					const afterValue = parseInt(/\s\d+/.exec(afterArr[j]));

					// Расчитываем изменение значений
					const diff = afterValue - beforeValue;

					// Чисто косметическое условие, если положительное, ставим плюс,
					if (diff > 0)
						added += `${beforeName} <b>+${diff}</b>\n`;
					// если отрицательное, то ничего не делаем, потому что минус уже есть
					else if (diff < 0)
						removed += `${beforeName} <b>${diff}</b>\n`;

				// Если added не содержит afterName и before не содержит afterLineStart
				} else if (added.indexOf(afterName) === -1 && before.indexOf(afterLineStart) === -1) {
					const afterValue = parseInt(/\s\d+/.exec(afterArr[j]));
					added += `️${afterName} <b>+${afterValue}</b>\n`;
				}
			}
		}

		// Опять проверяем наличие /add_ и чекаем флаг, совпадений быть не должно
		if (/add_/.exec(beforeArr[i]) && isExist === false) {
			// Получаем опять имя, значение
			const name = /\s\s\s(.+)/.exec(beforeArr[i])[1];
			const beforeValue = parseInt(/\s\d+/.exec(beforeArr[i]));

			// Так как этот блок отвечает за исчезнувшие позиции мы вычитаем само значение
			// и ставим красивый эмодзи
			removed += `${name} <b>-${beforeValue}️</b>\n`;
		}
	}

	if ((added + removed).length === (added_init + removed_init).length)
		return 'Изменений не обнаружено.';
	else if (added.length === added_init.length)
		return removed;
	else if (removed.length === removed_init.length)
		return added;
	else
		return added + removed;
}

// Обрабатываем команду /start
bot.onText(/^\/start/i, function (msg) {
	// Вставляем в базу данных базовый шаблон из массива, в который вложено два пустых объекта.
	r.table('users')
		.insert({
				id: msg.from.id,
				username: msg.from.username,
				stocks: [{}, {}]
			},
			{conflict: 'update'})

		// После завершения запроса в базу, высылаем юзеру сообщение с мини-инструкцией
		.then(function (res) {
			bot.sendMessage(msg.chat.id, 'Скинь два стока из @ChatWarsTradeBot и нажми /diff, чтобы узнать что ты потерял/приобрел.');
		})

		// Не забываем в случае ошибки дать предупреждение в логи
		.catch(function (error) {
			console.warn(error.message);
		});
});

// Обрабатываем полученные стоки
bot.onText(/^\uD83D\uDCE6Твой склад/, function (msg) {
	// Если сообщение не от оригинального Chat Wars Trade Bot,
	// и вообще не пересланное вовсе, то шлем лесом
	if (msg.forward_from !== undefined && msg.forward_from.id === 278525885) {
		// Если всё ок, то обновляем профиль юзера в базе сначала
		// добавляя последнее сообщение, а затем удаляя старое, чтобы не засорять базу
		r.table('users')
			.get(msg.from.id)
			.update({
				stocks: r.row('stocks')//.orderBy('date')
					.insertAt(0, {
						text: msg.text,
						date: r.epochTime(msg.forward_date)
					})

					.deleteAt(-1)
			})

			// В случае успеха уведомляем юзера, что всё ок
			.then(function (res) {
				bot.sendMessage(msg.chat.id, 'Сток принят.');
			})

			// Как обычно не забываем обработать ошибку, если всё плохо
			.catch(function (error) {
				console.warn(error.message);
			});
	} else
		// Как и было оговорено выше, если сообщение не такое какое нам нужно,
		// то мы пишем, что сток какой-то не такой
		bot.sendMessage(msg.chat.id, 'Со стоком что-то не так.');
});

// Наконец обрабатываем команду /diff
bot.onText(/^\/diff/i, function (msg) {
	// Берем из базы стоки, которые предварительно сортируем по дате пересланного
	r.table('users')
		.get(msg.from.id)('stocks').orderBy('date')

		// Когда таки взяли, то
		.then(function (res) {
			let text;
			// пробуем получить готовое сообщение из двух присланных текстов,
			// которые мы уже получили из базы данных
			try {
				text = getMessage(res[0].text, res[1].text);
			} catch (error) {
				console.warn(error.message);
				text = 'Со стоком что-то не так.';
			}

			// Отправляем готовое сообщение пользователю
			bot.sendMessage(msg.chat.id, text, {parse_mode: 'HTML'});
		})

		// Как обычно выбрасываем предупреждение, в случае ошибки
		.catch(function (error) {
			console.warn(error.message);
		})
});

// А тут мы просто логируем абсолютно все сообщения полученные от пользователей
bot.on('message', function (msg) {
	console.log(msg);
});