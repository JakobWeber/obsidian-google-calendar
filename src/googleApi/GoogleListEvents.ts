import type {
	EventCacheValue,
	GoogleCalendar,
	GoogleEvent,
	GoogleEventList,
	ListOptions
} from "../helper/types";

import GoogleCalendarPlugin from "src/GoogleCalendarPlugin";
import { createNotice } from "src/helper/NoticeHelper";
import { googleListCalendars } from "./GoogleListCalendars";
import { callRequest } from "src/helper/RequestWrapper";
import _ from "lodash"
import { settingsAreCompleteAndLoggedIn } from "../view/GoogleCalendarSettingTab";
import { allColorNames, getColorNameFromEvent } from "../googleApi/GoogleColors";

const cachedEvents = new Map<string, EventCacheValue>();

/**
 * Function to clear the complete event cache to force new request
 */
export function googleClearCachedEvents(): void {
	cachedEvents.clear()
}

/**
 * This function is the main function to get a list of events. The function uses named parameters to make it easy to use.
 * You can set a timespan with start-/enddate and ex-/include calendars 
 * @param Input Object for named parameters  
 * @returns A list of GoogleCalendarEvents
 */
export async function googleListEvents(
	{ startDate,
		endDate,
		exclude,
		include,
	}: ListOptions = {}
): Promise<GoogleEvent[]> {

	const plugin = GoogleCalendarPlugin.getInstance();

	//Make sure there is a start date
	if (!startDate) {
		startDate = window.moment();
	}
	startDate = startDate.startOf("day");

	//Make sure there is a end date
	if (!endDate) {
		endDate = startDate.clone();
	}
	endDate = endDate.endOf("day");

	//Get all calendars not on the black list
	let calendarList = await googleListCalendars();


	const [includeCalendars, includeColors] = (include ?? []).reduce(([pass, fail], elem) => {
		  return !allColorNames.includes(elem) ? [[...pass, elem], fail] : [pass, [...fail, elem]];
		}, [[], []]);
	

	const [excludeCalendars, excludeColors] = (exclude ?? []).reduce(([pass, fail], elem) => {
		return !allColorNames.includes(elem) ? [[...pass, elem], fail] : [pass, [...fail, elem]];
	  }, [[], []]);
  	
	console.log({excludeColors, includeColors, excludeCalendars, includeCalendars})


	//Get the list of calendars that should be queried
	if (includeCalendars.length) {
		calendarList = calendarList.filter((calendar: GoogleCalendar) =>
			(includeCalendars.contains(calendar.id) || includeCalendars.contains(calendar.summary))
		);
	} else if (excludeCalendars.length) {
		calendarList = calendarList.filter((calendar: GoogleCalendar) =>
			!(excludeCalendars.contains(calendar.id) || excludeCalendars.contains(calendar.summary))
		);
	}

	//Get Events from calendars
	let eventList: GoogleEvent[] = []
	for (let i = 0; i < calendarList.length; i++) {
		const events = await googleListEventsByCalendar(
			plugin,
			calendarList[i],
			startDate,
			endDate,
			includeColors,
			excludeColors
		);

		eventList = [...eventList, ...events];
	}

	//Sort because multi day requests will only sort by date
	eventList = _.orderBy(eventList, [(event: GoogleEvent) => new Date(event.start.date ?? event.start.dateTime)], "asc")

	return eventList;
}




// ===============================================================================
// =================== HELPER Functions to make to list events ===================
// ===============================================================================

/**
 * This function is the core of the list event function. It makes the http requests to the api and handles the pagination and error handling
 * @param plugin 
 * @param GoogleCalendar 
 * @param startString 
 * @param endString 
 * @returns 
 */
async function requestEventsFromApi(
	GoogleCalendar: GoogleCalendar,
	startString: string,
	endString: string
): Promise<GoogleEvent[]> {

	if (!settingsAreCompleteAndLoggedIn()) return [];

	let tmpRequestResult: GoogleEventList;
	const resultSizes = 2500;
	let totalEventList: GoogleEvent[] = [];
	do {
		let url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
			GoogleCalendar.id
		)}/events?`;
		url += `maxResults=${resultSizes}`;
		url += `&futureevents=true`
		url += `&singleEvents=true`;
		url += `&orderby=starttime`;
		url += `&sortorder=ascending`;
		url += `&timeMin=${startString}`;
		url += `&timeMax=${endString}`;

		if (tmpRequestResult && tmpRequestResult.nextPageToken) {
			url += `&nextPageToken=${tmpRequestResult.nextPageToken}`;
		}

		tmpRequestResult = await callRequest(url, "GET", null);

		if (!tmpRequestResult) {
			createNotice("Could not list Google Events");
			continue;
		}

		const newList = tmpRequestResult.items.filter((event) => {
			event.parent = GoogleCalendar;
			return event.status != "cancelled"
		});

		totalEventList = [...totalEventList, ...newList];
	} while (tmpRequestResult.items.length == resultSizes);

	return totalEventList;
}

/**
 * This function checks for multi day events and resolves them to multiple events
 * @param totalEventList 
 * @param date 
 * @param endDate 
 * @returns 
 */
function resolveMultiDayEventsHelper(
	totalEventList: GoogleEvent[],
	date?: moment.Moment,
	endDate?: moment.Moment
): GoogleEvent[] {
	let extraEvents: GoogleEvent[] = [];

	totalEventList.forEach((tmp: GoogleEvent) => {
		if (!tmp.start.dateTime || !tmp.end.dateTime) return;

		const endMoment = window.moment(tmp.end.dateTime);
		let startMoment = window.moment(tmp.start.dateTime);

		if (startMoment.isSame(endMoment, "day")) return;

		let extraEventsTmp: GoogleEvent[] = [];

		const totalDays = endMoment.endOf("day").diff(startMoment.startOf("day"), "days") + 1;

		const title = tmp.summary;

		let dayCount = 1;

		do {
			tmp.summary = `${title} (Day ${dayCount}/${totalDays})`
			tmp.eventType = "multiDay";
			extraEventsTmp = [...extraEventsTmp, structuredClone(tmp)];
			dayCount++;
			startMoment = startMoment.add(1, "days");
			tmp.start.dateTime = startMoment.format("YYYY-MM-DD HH:mm");
		} while (!startMoment.isAfter(endMoment, "day"));


		extraEventsTmp = extraEventsTmp.filter(event => {
			const startMoment = window.moment(event.start.dateTime);
			if (date && startMoment.isBefore(date, "day")) return false;
			if (endDate && startMoment.isSameOrAfter(endDate, "day")) return false;
			return true;
		})

		tmp.eventType = "delete";

		extraEvents = [...extraEvents, ...extraEventsTmp];

	});

	totalEventList = [...totalEventList, ...extraEvents];

	return totalEventList;
}

// Check if the range if events is already cached
function checkForCachedEvents (
	plugin: GoogleCalendarPlugin,
	GoogleCalendar: GoogleCalendar,
	startDate: moment.Moment,
	endDate: moment.Moment
) : GoogleEvent[] | null {
	
	let currentDate = startDate.clone();
	let cachedEventList: GoogleEvent[] = [];

	// Loop through all days and check if there is a cached result
	while (currentDate <= endDate) {
		
		const cacheKey: string = JSON.stringify({
			day: currentDate.format("YYYY-MM-DD"),
			calendar: GoogleCalendar.id
		});
		
		// Check if there is a day missing in the cache
		if(!cachedEvents.has(cacheKey)) {
			return null;
		}
		
		if(!plugin.settings.useCustomClient && plugin.settings.refreshInterval < 60){
			plugin.settings.refreshInterval = 60;
		}
		
		// Get the cached events and check if they are still valid
		const { events, updated } = cachedEvents.get(cacheKey);	
		if (updated.clone().add(plugin.settings.refreshInterval, "second").isBefore(window.moment())) {
			return null
		}
		
		// Add the events to the list
		cachedEventList = [...cachedEventList, ...events];
		
		// Check the next day
		currentDate.add(1, "day");
		
	}
	
	return cachedEventList;
}


/**
 * This function will return a list of event in a timespan from a specific calendar
 * The function will check for an equal function call in the cache if there is a stored result that is not to old it will return without api request
 * @param GoogleCalendar  the calendar to get the events from
 * @param date the startdate of the checking time
 * @param endDate the enddate of the checking time
 * @returns a list of Google Events
 */
async function googleListEventsByCalendar(
	plugin: GoogleCalendarPlugin,
	GoogleCalendar: GoogleCalendar,
	startDate: moment.Moment,
	endDate: moment.Moment,
	includeColors: string[] = [],
	excludeColors: string[] = []
): Promise<GoogleEvent[]> {

	//Check if the events are already cached and return them if they are
	const alreadyCachedEvents = checkForCachedEvents(plugin, GoogleCalendar, startDate, endDate)
	if(alreadyCachedEvents) {
		return alreadyCachedEvents.filter((indexEvent: GoogleEvent) => {
			if ( includeColors.length > 0) {
				return includeColors.includes(getColorNameFromEvent(indexEvent));
			} 
			if ( excludeColors.length > 0) {
				return !excludeColors.includes(getColorNameFromEvent(indexEvent));
			}
			return true;
		});
	}
	
	//Get the events because cache was no option
	let totalEventList: GoogleEvent[] = await requestEventsFromApi(GoogleCalendar, startDate.toISOString(), endDate.toISOString());

	//Turn multi day events into multiple events
	totalEventList = resolveMultiDayEventsHelper(totalEventList, startDate, endDate);

	// Group events by Day
	const groupedEvents = _.groupBy(totalEventList, (event: GoogleEvent) => {
		const startMoment = window.moment(event.start.dateTime ?? event.start.date);
		return startMoment.format("YYYY-MM-DD");
	});

	const currentDate = startDate.clone();
	while (currentDate <= endDate) {
		const formattedDate = currentDate.format("YYYY-MM-DD");

		const cacheKey: string = JSON.stringify({ day: formattedDate, calendar: GoogleCalendar.id });
		cachedEvents.set(cacheKey, { events: groupedEvents[formattedDate] || [], updated: window.moment() })
		
		currentDate.add(1, "day");
	}

	return totalEventList.filter((indexEvent: GoogleEvent) => {
		if ( indexEvent.eventType === "delete") return false;
		if ( includeColors.length > 0) {
			return includeColors.includes(getColorNameFromEvent(indexEvent));
		} 
		if ( excludeColors.length > 0) {
			return !excludeColors.includes(getColorNameFromEvent(indexEvent));
		}
		return true;
	});
}
