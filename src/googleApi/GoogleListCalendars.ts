import type { GoogleCalander, GoogleCalanderList } from "./../helper/types";

import GoogleCalendarPlugin from "src/GoogleCalendarPlugin";
import { createNotice } from "src/helper/NoticeHelper";
import { getGoogleAuthToken } from "./GoogleAuth";
import { getGoogleColors } from "./GoogleColors";


let cachedCalendars:GoogleCalander[] = []

/**
 * This function is used to filter out all calendars that are on the users blacklist
 * @param plugin a refrence to the main plugin object
 * @param calendars The list of all possible calendars
 * @returns The filtered list of calendars
 */
function filterCalendarsByBlackList(plugin:GoogleCalendarPlugin, calendars:GoogleCalander[]):GoogleCalander[]{
	//Remove the calendars contained in the blacklist
	const filteredCalendars = calendars.filter((calendar) => {
		const foundIndex = plugin.settings.calendarBlackList.findIndex(
			(c) => c[0] == calendar.id
		);
		return foundIndex == -1;
	});
	return filteredCalendars;
}

/**
 * This functions get all google calendars from the user that were not Black listed by him
 * The function will check if there are already saved calendars if not it will request them from the google API
 * @returns A List of Google Calendars
 */
export async function googleListCalendars(): Promise<GoogleCalander[]> {

	const plugin = GoogleCalendarPlugin.getInstance();

	if(cachedCalendars.length){
		//Filter for every request instead of caching the filtered result to allow hot swap settings
		return filterCalendarsByBlackList(plugin,cachedCalendars);
	}

	//Make sure the colors for calendar and events are loaded before getting the first calendar
	await getGoogleColors();

	const requestHeaders: HeadersInit = new Headers();
	requestHeaders.append(
		"Authorization",
		"Bearer " + (await getGoogleAuthToken())
	);
	requestHeaders.append("Content-Type", "application/json");

	try {
		const response = await fetch(
			`https://www.googleapis.com/calendar/v3/users/me/calendarList?key=${plugin.settings.googleApiToken}`,
			{
				method: "GET",
				headers: requestHeaders,
			}
		);
		const calendarList: GoogleCalanderList = await response.json();

		cachedCalendars = calendarList.items;

		const calendars = filterCalendarsByBlackList(plugin, calendarList.items);

		return calendars;
	} catch (error) {
		createNotice("Could not load google calendars");
		return [];
	}
}
