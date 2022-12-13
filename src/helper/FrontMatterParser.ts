import { FrontMatterCache, MarkdownView, normalizePath, TFile } from "obsidian";
import { googleListCalendars } from "src/googleApi/GoogleListCalendars";
import  GoogleCalendarPlugin from 'src/GoogleCalendarPlugin';
import _ from "lodash";

export const getEventFromFrontMatter = async (view: MarkdownView): Promise<FrontMatterCache> => {
    
    const plugin = GoogleCalendarPlugin.getInstance();

    const fileContent = await app.vault.adapter.read(normalizePath(view.file.path));

    //Use a copy to prevent problems when running the command multiple times
    const frontmatter:any = { ...app?.metadataCache?.getFileCache(view.file).frontmatter} ?? {};
    
    //Get dataview frontmatter form the file
    const regexp = /\[([^[]*)::([^[]*)\]/gm;
    let matches;
    const output = [];
    do {
        matches = regexp.exec(fileContent);
        output.push(matches);
    } while(matches);


    output.forEach(match => {
        if(match){
            _.set(frontmatter, match[1].trim(), match[2].trim());
        }
    });

    if(!frontmatter) {
        return;
    }

    const frontMatterMapping = getFrontMatterMapping(frontmatter);
    //Use the mapping to resolve the values to the selected event details
    for(const [key, value] of Object.entries(frontMatterMapping)) {        
        const eventValue = _.get(frontmatter, key, null)
        if(eventValue){
            _.set(frontmatter, value, eventValue);
        }
    }
    const calendars = await googleListCalendars();
    delete frontmatter.position;
   
    const calendar = calendars.find(calendar => calendar.id == (frontmatter.calendar ?? plugin.settings.defaultCalendar) || calendar.summary  == (frontmatter.calendar ?? plugin.settings.defaultCalendar));
    if(!calendar)return;
    frontmatter.parent = calendar;

    //Check for a summary if there is none defined

    if(!frontmatter.summary) {
        frontmatter.summary = view.file.basename;
    }


    //Check for start and end date if there is none defined
    if(!frontmatter.start && !frontmatter.startTime){
        frontmatter.start = {date: window.moment()}
    }
    if(!frontmatter.end && !frontmatter.endTime){
        frontmatter.end = frontmatter.start
    }
    
    if(frontmatter.start.date){
        frontmatter.start.date = window.moment(frontmatter.start.date).format("YYYY-MM-DD");
        frontmatter.end.date = window.moment(frontmatter.end.date).format("YYYY-MM-DD"); 
    }else{
        frontmatter.start.dateTime = window.moment(frontmatter.start.dateTime).format();
        frontmatter.end.dateTime = window.moment(frontmatter.end.dateTime).format(); 
    }

    return frontmatter;
}

const getFrontMatterMapping = (frontmatter:FrontMatterCache): Map<string, string> => {

    const {adapter} = app.vault;

    const mapping = new Map<string, string>();

    //Allow loading mapping data from another file 
    if(typeof frontmatter.mapping == "string") {
        if(!frontmatter.mapping.endsWith(".md")){
            frontmatter.mapping += ".md"
        }
        const newPath = normalizePath(frontmatter.mapping);

        if(!adapter.exists(newPath))return mapping;

        const file = app.vault.getAbstractFileByPath(newPath) as TFile;
        frontmatter = app?.metadataCache?.getFileCache(file).frontmatter;
        if(!frontmatter)return mapping;
    }

    if(!frontmatter.mapping)return mapping;

    return frontmatter.mapping;
}
