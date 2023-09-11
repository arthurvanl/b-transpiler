import { Transpiler, type JavaScriptLoader } from "bun";
import { lstatSync, mkdirSync, readFileSync, readdirSync, rmdirSync, unlinkSync } from "fs";

export interface Folder {
    /** the parent folder path */
    readonly path?: string;
    /** folder name */
    name: string;
    /** exclude files from this specific folder */
    exclude?: `${string}.${JavaScriptLoader}`[]; // file names
    /* sub folders */
    folders?: Folder[]
}

export class BTranspiler {
    private outdir!: string;
    private folders: Folder[] = [];
    private transpiler: Transpiler;

    constructor() {
        this.transpiler = new Transpiler({ loader: 'ts' });
    }

    /**
     * Set the folder name so we can determ where we need to put the transpiled code
     * @param outdir - the outdir folder
     * @returns 
     */
    public setOutdir(outdir: string) {

        this.outdir = outdir;
        return this;
    }

    /**
     * Add a folder that'll transform childs
     * Exclude files (with extension) if needed
     * @param folder - add
     * @param exclude - exclude specific files
     * @param sub_folders - sub folders within it's parent folder
     * @example
     * addFolder("api");
     * @example
     * addFolder("api", ['index.ts'], sub_folders: [{name: 'game'}]);
     * @returns 
     */
    public addFolder(folder: string, exclude?: Folder['exclude'], sub_folders?: Folder[]) {

        if(sub_folders) {
            sub_folders = sub_folders.map((f) => this.addParentPath(folder, f));
        }
      
        const validated = this.validateFolder({ path: '', name: folder, exclude: exclude ?? [], folders: sub_folders ?? [] });
        if(!validated) return this;

        this.folders.push({ path: '', name: folder, exclude: exclude ?? [], folders: sub_folders ?? [] });
        return this;
    }

    /**
     * Transform source code to javascript
     */
    public async transform() {

        const bundle_folder = lstatSync(`${process.cwd()}/${this.outdir}`, { throwIfNoEntry: false });
        if(!bundle_folder) {
            mkdirSync(`${process.cwd()}/${this.outdir}`);
        } else if(!bundle_folder.isDirectory()) {
            throw new Error(`The outdir file "${this.outdir}" in "${process.cwd()}" is not an directory`);
        }

        this.removeOutdirFiles();

        for(const folder of this.folders) {

            await this.transformFolder(folder);
        }
    }

    private async transformFolder(folder: Folder) {

        const base_path = folder.path?.length !== 0 ? `${folder.path}/${folder.name}` : folder.name;

        // get filtered folder files
        let files = readdirSync(`${import.meta.dir}/${base_path}`).filter((f) => folder.exclude?.find((x) => x !== f) && (f.endsWith('.ts') || f.endsWith('.js')));
        
        // creating directory
        mkdirSync(`${process.cwd()}/${this.outdir}/${base_path}`);

        for(const file of files) {

            const code = this.transformFile(`${import.meta.dir}/${base_path}/${file}`);
            const out_path = `${process.cwd()}/${this.outdir}/${base_path}/${file.replace('ts', 'js')}`
            const bytes = await this.addTransformedFile(out_path, code);
            console.log(`wrote file: "${out_path}" (${bytes} bytes)`)
        }

        if(folder.folders) {
            folder.folders.forEach((f) => this.transformFolder(f));
        }
    }

    /**
     * Add transformed code to the outdir.
     * @param path - the path where the bundled code must be added too
     * @param code - the code that is transformed
     * @returns 
     */
    public async addTransformedFile(path: string, code: string) {

        try {
            return await Bun.write(path, code);
        } catch (err) {
            throw new Error(`Couldn't write to "${path}"`);
        }
    }

    /**
     * Transpile typescript code into javascript using bun transpiler
     * @param path - the file path
     * @returns 
     */
    public transformFile(path: string) {
        
        const code = readFileSync(path, 'utf-8');
        
        return this.transpiler.transformSync(code);
    }

    /**
     * Removes all files within the outdir
     */
    private removeOutdirFiles() {

        const files = readdirSync(`${process.cwd()}/${this.outdir}`);
        for(const file of files) {

            const stats = this.checkFile(file, false, false, `${process.cwd()}/${this.outdir}`);
            if(stats && stats.isDirectory()) {
                rmdirSync(`${process.cwd()}/${this.outdir}/${file}`, {recursive: true})
            } else if(stats && stats.isFile()) {
                unlinkSync(`${process.cwd()}/${this.outdir}/${file}`);
            }
        }
    }

    /**
     * Add parent path to subfolder
     * @param path - the parent path that should be added
     * @param folder - the folder where the path must be added too
     * @returns
     */
    private addParentPath(path: string, folder: Folder) {

        if(folder.folders) {
            folder.folders = folder.folders.map((f) => this.addParentPath(`${path}/${folder.name}`, f));
        }

        Reflect.set(folder, 'path', path);

        return folder;
    }

    /**
     * Validate file paths & existance of folders
     * @param folder - the folder that must be validated
     * @returns 
     */
    private validateFolder(folder: Folder) {

        if(this.folders.find((x) => x.name === folder.name)) return false;

        const base_path = folder.path?.length !== 0 ? `${folder.path}/${folder.name}` : folder.name;

        this.checkFile(base_path, true);

        if(folder.exclude) {
            folder.exclude.forEach((f) => this.checkFile(`${base_path}/${f}`));
        }

        if(folder.folders) {
            folder.folders.forEach((f) => this.validateFolder(f));
        }

        return true;
    }

    /**
     * Checks if the file/folder path exist
     * Throws an "Error" if path doesn't exist
     * @param file - the file/folder that must be checked
     * @param dir - wether the file is a directory
     * @param error - wether to throw an error
     * @returns 
     */
    private checkFile(file: string, dir: boolean = false, error: boolean = true, base_path = import.meta.dir) {

        const stats = lstatSync(`${base_path}/${file}`, {throwIfNoEntry: false});

        if(!stats) {
            throw new Error(`Cannot find ${dir ? 'folder' : 'file'} "${file}" in "${base_path}"`);
        }

        if(stats && base_path !== import.meta.dir) {
            return stats;
        }

        if(stats.isDirectory() && !dir && error) {
            throw new Error(`Cannot find folder "${file}" in "${base_path}"`);
        } else if(stats.isDirectory() && !dir) {
            return false;
        }

        if(stats.isFile() && dir && error) {
            throw new Error(`Cannot find path "${file}" in "${base_path}"`)
        } else if(stats.isFile() && dir) {
            return false;
        }

        return stats;
    }
}